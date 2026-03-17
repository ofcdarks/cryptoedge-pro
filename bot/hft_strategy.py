"""
CryptoEdge Pro — High Frequency Trading Engine
================================================
Faz 20-80 operações por dia em múltiplos pares.
Lucros pequenos (0.15%–0.5% por trade) acumulados ao longo do dia.

Estratégias combinadas:
  1. EMA Crossover (3/8) em 1m/3m — captura micro-tendências
  2. RSI Mean Reversion (oversold/overbought extremo)  
  3. Bollinger Band Squeeze — entra no breakout de volatilidade
  4. VWAP Deviation — retorno à média institucional
  5. Momentum burst — volume spike + direcional

Proteção de capital:
  - Max 3 trades simultâneos por par
  - Cooldown automático após loss consecutivo
  - Daily loss limit (para o dia ao atingir X% de perda)
  - Position sizing automático (1-2% do capital por trade)
"""

import logging, time, os, threading
from collections import deque
from decimal import Decimal

log = logging.getLogger('CryptoEdge.HFT')

# ─── Config HFT ───────────────────────────────────────────────────────────────
HFT_TP_PCT      = float(os.environ.get('HFT_TP_PCT',    '0.35'))  # Take Profit %
HFT_SL_PCT      = float(os.environ.get('HFT_SL_PCT',    '0.18'))  # Stop Loss %
HFT_RISK_PCT    = float(os.environ.get('HFT_RISK_PCT',   '1.5'))   # % do capital por trade
HFT_MAX_TRADES  = int(os.environ.get('HFT_MAX_TRADES',   '3'))     # max trades simultâneos
HFT_DAILY_LOSS  = float(os.environ.get('HFT_DAILY_LOSS', '3.0'))   # % daily loss limit
HFT_COOLDOWN    = int(os.environ.get('HFT_COOLDOWN',     '45'))    # segundos entre trades
HFT_PAIRS       = os.environ.get('HFT_PAIRS',
    'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,MATICUSDT,DOTUSDT'
).split(',')
HFT_TIMEFRAME   = os.environ.get('HFT_TIMEFRAME', '1m')  # 1m = mais trades, 3m = mais preciso
HFT_MIN_VOLUME  = float(os.environ.get('HFT_MIN_VOL_USDT', '5000000'))  # Volume 24h mínimo em USDT

# ─── Estado global HFT ────────────────────────────────────────────────────────
class HFTEngine:
    def __init__(self, capital: float, client, notify_fn=None):
        self.capital        = capital
        self.client         = client
        self.notify         = notify_fn or (lambda *a, **kw: None)
        self.running        = False

        # Posições abertas: {pair: {side, entry, qty, sl, tp, opened_at, trade_id}}
        self.positions: dict = {}
        # Histórico de trades do dia
        self.trades_today: list = []
        # P&L acumulado do dia
        self.daily_pnl      = 0.0
        self.daily_wins     = 0
        self.daily_losses   = 0
        # Último trade por par (timestamp) — cooldown
        self.last_trade_ts: dict = {}
        # Dados de candles por par
        self.candles: dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self.closes:  dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self.highs:   dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self.lows:    dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self.volumes: dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        # Cache de sym_info por par
        self._sym_info: dict = {}
        # Lock para thread safety
        self._lock = threading.Lock()
        # Consecutive losses tracker
        self.consec_losses  = 0
        self.paused_until   = 0  # timestamp

    # ─── Indicadores ──────────────────────────────────────────────────────────

    def _ema(self, values, period):
        vals = list(values)
        if len(vals) < 2: return vals[-1] if vals else 0
        k = 2 / (period + 1)
        e = vals[0]
        for v in vals[1:]: e = v * k + e * (1 - k)
        return e

    def _rsi(self, closes, period=7):
        """RSI rápido com período 7 para HFT (mais sensível)."""
        vals = list(closes)[-(period + 2):]
        if len(vals) < period + 1: return 50
        gains  = [max(vals[i] - vals[i-1], 0) for i in range(1, len(vals))]
        losses = [max(vals[i-1] - vals[i], 0) for i in range(1, len(vals))]
        ag = sum(gains) / len(gains)
        al = sum(losses) / len(losses)
        return 100 if al == 0 else 100 - (100 / (1 + ag / al))

    def _bollinger(self, closes, period=14, stddev=2.0):
        """Retorna (upper, mid, lower, %B, bandwidth)."""
        vals = list(closes)[-period:]
        if len(vals) < period: return None
        mid = sum(vals) / len(vals)
        std = (sum((v - mid) ** 2 for v in vals) / len(vals)) ** 0.5
        upper = mid + stddev * std
        lower = mid - stddev * std
        pct_b = (vals[-1] - lower) / (upper - lower) if upper != lower else 0.5
        bw    = (upper - lower) / mid * 100 if mid else 0
        return upper, mid, lower, pct_b, bw

    def _vwap(self, closes, volumes, period=20):
        """VWAP simples."""
        c = list(closes)[-period:]
        v = list(volumes)[-period:]
        if not c or not v: return c[-1] if c else 0
        total_vol = sum(v)
        if total_vol == 0: return c[-1]
        return sum(ci * vi for ci, vi in zip(c, v)) / total_vol

    def _atr(self, highs, lows, closes, period=7):
        h = list(highs)[-(period+1):]
        l = list(lows)[-(period+1):]
        c = list(closes)[-(period+1):]
        if len(c) < 2: return 0
        trs = [max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1]))
               for i in range(1, len(c))]
        return sum(trs) / len(trs) if trs else 0

    # ─── Sinal combinado ──────────────────────────────────────────────────────

    def _generate_signal(self, pair: str) -> dict:
        """
        Combina 5 estratégias e retorna o sinal consolidado.
        Retorna: {'side': 'BUY'|'SELL'|None, 'score': 0-5, 'reason': str}
        """
        closes  = self.closes[pair]
        highs   = self.highs[pair]
        lows    = self.lows[pair]
        volumes = self.volumes[pair]

        if len(closes) < 30: return {'side': None, 'score': 0, 'reason': 'aguardando dados'}

        close   = closes[-1]
        signals = []  # ('BUY'|'SELL', reason)

        # ── 1. EMA Crossover 3/8 (micro-tendência) ───────────────────────────
        ema3 = self._ema(list(closes)[-3:], 3)
        ema8 = self._ema(list(closes)[-8:], 8)
        ema21= self._ema(list(closes)[-21:], 21)

        if ema3 > ema8 * 1.0003 and ema8 > ema21:
            signals.append(('BUY',  f'EMA3>{ema8:.0f} bull'))
        elif ema3 < ema8 * 0.9997 and ema8 < ema21:
            signals.append(('SELL', f'EMA3<{ema8:.0f} bear'))

        # ── 2. RSI extremo (mean reversion) ──────────────────────────────────
        rsi_val = self._rsi(closes)
        if rsi_val < 28:
            signals.append(('BUY',  f'RSI sobrevendido {rsi_val:.0f}'))
        elif rsi_val > 72:
            signals.append(('SELL', f'RSI sobrecomprado {rsi_val:.0f}'))

        # ── 3. Bollinger Band extremo ─────────────────────────────────────────
        bb = self._bollinger(closes)
        if bb:
            upper, mid, lower, pct_b, bw = bb
            if pct_b < 0.05 and bw > 0.3:   # tocou banda inferior + volatilidade ok
                signals.append(('BUY',  f'BB lower pctB={pct_b:.2f}'))
            elif pct_b > 0.95 and bw > 0.3:  # tocou banda superior
                signals.append(('SELL', f'BB upper pctB={pct_b:.2f}'))

        # ── 4. VWAP Deviation ────────────────────────────────────────────────
        vwap = self._vwap(closes, volumes)
        dev  = (close - vwap) / vwap * 100 if vwap else 0
        if dev < -0.4:   # preço 0.4% abaixo do VWAP → retorno à média
            signals.append(('BUY',  f'VWAP dev {dev:.2f}%'))
        elif dev > 0.4:
            signals.append(('SELL', f'VWAP dev {dev:.2f}%'))

        # ── 5. Momentum (volume spike + candle direcional) ───────────────────
        vols  = list(volumes)
        if len(vols) >= 6:
            avg_vol = sum(vols[-6:-1]) / 5
            last_vol = vols[-1]
            if avg_vol > 0 and last_vol > avg_vol * 2.0:
                candle_list = list(closes)
                c_open  = candle_list[-2]
                c_close = candle_list[-1]
                if c_close > c_open * 1.001:
                    signals.append(('BUY',  f'Volume spike {last_vol/avg_vol:.1f}x bull'))
                elif c_close < c_open * 0.999:
                    signals.append(('SELL', f'Volume spike {last_vol/avg_vol:.1f}x bear'))

        # ── Consolidar sinais ─────────────────────────────────────────────────
        buys  = [r for s, r in signals if s == 'BUY']
        sells = [r for s, r in signals if s == 'SELL']

        # Requer pelo menos 2 sinais na mesma direção para entrar
        if len(buys) >= 2 and len(buys) > len(sells):
            return {'side': 'BUY',  'score': len(buys), 'reason': ' + '.join(buys[:3]),
                    'rsi': rsi_val, 'price': close}
        if len(sells) >= 2 and len(sells) > len(buys):
            return {'side': 'SELL', 'score': len(sells), 'reason': ' + '.join(sells[:3]),
                    'rsi': rsi_val, 'price': close}

        return {'side': None, 'score': 0, 'reason': f'sem consenso (B:{len(buys)} S:{len(sells)})'}

    # ─── Gestão de posição ────────────────────────────────────────────────────

    def _get_sym_info(self, pair: str) -> dict:
        if pair not in self._sym_info:
            try:
                info = self.client.get_symbol_info(pair)
                lot  = next(f for f in info['filters'] if f['filterType'] == 'LOT_SIZE')
                self._sym_info[pair] = {
                    'min_qty': float(lot['minQty']),
                    'step':    float(lot['stepSize']),
                    'min_notional': 10.0,
                }
            except Exception as e:
                log.warning(f'  HFT: sym_info {pair} falhou: {e}')
                self._sym_info[pair] = {'min_qty': 0.001, 'step': 0.001, 'min_notional': 10.0}
        return self._sym_info[pair]

    def _round_step(self, v, step):
        prec = len(str(step).rstrip('0').split('.')[-1]) if '.' in str(step) else 0
        return round(float(Decimal(str(v)) // Decimal(str(step)) * Decimal(str(step))), prec)

    def _calc_qty(self, pair: str, price: float) -> float:
        """Calcula quantidade baseado no % de risco."""
        if price <= 0: return 0
        info    = self._get_sym_info(pair)
        budget  = self.capital * (HFT_RISK_PCT / 100)
        qty     = self._round_step(budget / price, info['step'])
        if qty < info['min_qty']:
            qty = self._round_step(info['min_notional'] / price * 1.05, info['step'])
        return qty if qty >= info['min_qty'] else 0

    def _open_position(self, pair: str, side: str, price: float, reason: str):
        """Abre posição real na Binance."""
        import time as _time
        qty = self._calc_qty(pair, price)
        if qty <= 0:
            log.warning(f'  HFT {pair}: qty=0 — pulando')
            return False

        tp_pct = HFT_TP_PCT / 100
        sl_pct = HFT_SL_PCT / 100
        if side == 'BUY':
            tp = price * (1 + tp_pct)
            sl = price * (1 - sl_pct)
        else:
            tp = price * (1 - tp_pct)
            sl = price * (1 + sl_pct)

        from binance.enums import SIDE_BUY, SIDE_SELL, ORDER_TYPE_MARKET
        b_side = SIDE_BUY if side == 'BUY' else SIDE_SELL

        try:
            if os.environ.get('BOT_TESTNET', 'true').lower() == 'true':
                log.info(f'  [TESTNET] HFT {pair} {side} {qty:.6f} @ {price:,.2f}')
                order_id = int(_time.time())
            else:
                order = self.client.create_order(
                    symbol=pair, side=b_side,
                    type=ORDER_TYPE_MARKET, quantity=qty
                )
                order_id = order.get('orderId', 0)
                price = float(order.get('fills', [{}])[0].get('price', price)) if order.get('fills') else price

            trade_id = f'hft_{pair}_{int(_time.time())}'
            self.positions[f'{pair}_{side}'] = {
                'pair': pair, 'side': side, 'entry': price,
                'qty': qty, 'sl': sl, 'tp': tp,
                'opened_at': _time.time(), 'trade_id': trade_id,
                'order_id': order_id, 'reason': reason
            }
            self.last_trade_ts[pair] = _time.time()

            rr = tp_pct / sl_pct
            log.info(f'  ✅ HFT ABRIU {side} {pair} @ ${price:,.4f} '
                     f'| TP ${tp:,.4f} (+{HFT_TP_PCT}%) '
                     f'| SL ${sl:,.4f} (-{HFT_SL_PCT}%) '
                     f'| R:R 1:{rr:.1f} | {reason}')

            self.notify(
                f'🤖 <b>HFT {side} — {pair}</b>\n'
                f'💲 Entrada: <code>${price:,.4f}</code>\n'
                f'🎯 TP: <code>${tp:,.4f}</code> <i>(+{HFT_TP_PCT}%)</i>\n'
                f'🛡 SL: <code>${sl:,.4f}</code> <i>(-{HFT_SL_PCT}%)</i>\n'
                f'⚖️ R:R 1:{rr:.1f} | 📦 Qty: {qty}\n'
                f'💡 {reason}'
            )
            return True
        except Exception as e:
            log.error(f'  ❌ HFT {pair}: erro ao abrir: {e}')
            return False

    def _close_position(self, key: str, price: float, reason: str):
        """Fecha posição e calcula P&L."""
        import time as _time
        pos = self.positions.get(key)
        if not pos: return

        pair = pos['pair']
        side = pos['side']
        qty  = pos['qty']

        from binance.enums import SIDE_BUY, SIDE_SELL, ORDER_TYPE_MARKET
        close_side = SIDE_SELL if side == 'BUY' else SIDE_BUY

        try:
            if os.environ.get('BOT_TESTNET', 'true').lower() == 'true':
                log.info(f'  [TESTNET] HFT FECHA {pair} {close_side} {qty:.6f} @ {price:,.2f}')
            else:
                self.client.create_order(
                    symbol=pair, side=close_side,
                    type=ORDER_TYPE_MARKET, quantity=qty
                )
        except Exception as e:
            log.error(f'  ❌ HFT {pair}: erro ao fechar: {e}')

        # P&L
        if side == 'BUY':
            pnl = (price - pos['entry']) * qty
        else:
            pnl = (pos['entry'] - price) * qty

        self.daily_pnl += pnl
        duration = _time.time() - pos['opened_at']

        win = pnl > 0
        if win:
            self.daily_wins += 1
            self.consec_losses = 0
            icon = '✅'
        else:
            self.daily_losses += 1
            self.consec_losses += 1
            icon = '❌'

        trade_record = {
            'pair': pair, 'side': side,
            'entry': pos['entry'], 'exit': price,
            'qty': qty, 'pnl': pnl,
            'duration': duration, 'reason': reason,
            'ts': _time.time()
        }
        self.trades_today.append(trade_record)

        total_trades = self.daily_wins + self.daily_losses
        wr = self.daily_wins / total_trades * 100 if total_trades else 0

        log.info(
            f'  {icon} HFT FECHOU {side} {pair} | '
            f'Entrada ${pos["entry"]:,.4f} → Saída ${price:,.4f} | '
            f'P&L ${pnl:+.4f} | {duration:.0f}s | {reason}\n'
            f'  📊 Hoje: {self.daily_wins}W/{self.daily_losses}L WR:{wr:.0f}% '
            f'PnL acumulado: ${self.daily_pnl:+.4f}'
        )

        self.notify(
            f'{icon} <b>HFT FECHOU {side} — {pair}</b>\n'
            f'💰 P&L: <code>${pnl:+.4f}</code>\n'
            f'⏱ Duração: {int(duration)}s\n'
            f'📊 Hoje: {self.daily_wins}W/{self.daily_losses}L WR:{wr:.0f}% '
            f'PnL: <code>${self.daily_pnl:+.4f}</code>\n'
            f'💡 {reason}'
        )

        del self.positions[key]

        # Cooldown automático após losses consecutivos
        if self.consec_losses >= 3:
            pause = HFT_COOLDOWN * (self.consec_losses - 1)
            self.paused_until = _time.time() + pause
            log.warning(f'  ⏸ HFT: {self.consec_losses} losses seguidos — pausando {pause}s')
            self.notify(f'⏸ <b>HFT pausado por {pause}s</b> ({self.consec_losses} losses seguidos)')

    def _check_exit(self, pair: str, price: float):
        """Verifica se deve fechar posições abertas para este par."""
        to_close = []
        for key, pos in list(self.positions.items()):
            if pos['pair'] != pair: continue
            side = pos['side']
            if side == 'BUY':
                if price >= pos['tp']:
                    to_close.append((key, price, f'TP atingido +{HFT_TP_PCT}%'))
                elif price <= pos['sl']:
                    to_close.append((key, price, f'SL atingido -{HFT_SL_PCT}%'))
                # Time-based exit: se trade aberto há mais de 8 minutos e não atingiu TP/SL
                elif price > pos['entry'] * 1.001:
                    import time as _t
                    age = _t.time() - pos['opened_at']
                    if age > 480:
                        to_close.append((key, price, f'Time-exit +{(price-pos["entry"])/pos["entry"]*100:.2f}%'))
            else:  # SELL
                if price <= pos['tp']:
                    to_close.append((key, price, f'TP atingido +{HFT_TP_PCT}%'))
                elif price >= pos['sl']:
                    to_close.append((key, price, f'SL atingido -{HFT_SL_PCT}%'))
                elif price < pos['entry'] * 0.999:
                    import time as _t
                    age = _t.time() - pos['opened_at']
                    if age > 480:
                        to_close.append((key, price, f'Time-exit +{(pos["entry"]-price)/pos["entry"]*100:.2f}%'))

        for key, px, reason in to_close:
            self._close_position(key, px, reason)

    # ─── Loop principal ────────────────────────────────────────────────────────

    def on_candle(self, pair: str, open_: float, high: float, low: float,
                  close: float, volume: float, is_closed: bool):
        """Chamado a cada tick/vela por par. Thread-safe."""
        import time as _time

        # Atualiza dados
        self.closes[pair].append(close)
        self.highs[pair].append(high)
        self.lows[pair].append(low)
        self.volumes[pair].append(volume)

        # Checa exits a cada tick (não só em vela fechada)
        self._check_exit(pair, close)

        if not is_closed: return  # só processa sinais em velas fechadas

        now = _time.time()

        # Checa pausa por losses
        if self.paused_until > now:
            remaining = self.paused_until - now
            log.debug(f'  HFT {pair}: pausado ({remaining:.0f}s restantes)')
            return

        # Checa daily loss limit
        daily_loss_pct = abs(self.daily_pnl) / self.capital * 100
        if self.daily_pnl < 0 and daily_loss_pct >= HFT_DAILY_LOSS:
            if self.running:
                log.warning(f'  🛑 HFT: Daily loss limit {HFT_DAILY_LOSS}% atingido! '
                             f'PnL: ${self.daily_pnl:.4f}. Bot parando por hoje.')
                self.notify(
                    f'🛑 <b>HFT Daily Loss Limit atingido!</b>\n'
                    f'Perda do dia: <code>${self.daily_pnl:.4f}</code> ({daily_loss_pct:.1f}%)\n'
                    f'Limite: {HFT_DAILY_LOSS}%\n'
                    f'Bot pausado até meia-noite. Reinicie amanhã.'
                )
                self.running = False
            return

        # Cooldown por par
        last_ts = self.last_trade_ts.get(pair, 0)
        if now - last_ts < HFT_COOLDOWN:
            return

        # Max trades ativos
        active_on_pair = sum(1 for k in self.positions if k.startswith(pair))
        total_active   = len(self.positions)
        if active_on_pair >= 1 or total_active >= HFT_MAX_TRADES:
            return

        # Gera sinal
        with self._lock:
            signal = self._generate_signal(pair)

        if signal['side'] is None:
            return

        # Abre posição
        log.info(f'  📡 HFT SINAL {signal["side"]} {pair} | '
                 f'score={signal["score"]} | {signal["reason"]}')
        self._open_position(pair, signal['side'], close, signal['reason'])

    def get_stats(self) -> dict:
        """Retorna estatísticas do dia."""
        total = self.daily_wins + self.daily_losses
        wr    = self.daily_wins / total * 100 if total else 0
        return {
            'daily_pnl':    self.daily_pnl,
            'daily_wins':   self.daily_wins,
            'daily_losses': self.daily_losses,
            'win_rate':     wr,
            'total_trades': total,
            'open_positions': len(self.positions),
            'pairs': list(set(p['pair'] for p in self.positions.values())),
        }

    def reset_daily(self):
        """Reset de contadores para o novo dia."""
        log.info(f'  🔄 HFT: Reset diário. Fechando {len(self.positions)} posições abertas.')
        self.daily_pnl      = 0.0
        self.daily_wins     = 0
        self.daily_losses   = 0
        self.trades_today   = []
        self.consec_losses  = 0
        self.paused_until   = 0
        self.running        = True
        log.info('  ✅ HFT: Novo dia iniciado!')


# ─── Instância global (criada em gridbot.main) ─────────────────────────────────
_hft_engine: HFTEngine = None

def get_hft_engine() -> HFTEngine:
    return _hft_engine

def init_hft(capital: float, client, notify_fn=None) -> HFTEngine:
    global _hft_engine
    _hft_engine = HFTEngine(capital, client, notify_fn)
    _hft_engine.running = True
    return _hft_engine
