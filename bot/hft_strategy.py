"""
CryptoEdge Pro — HFT Engine v2.0
==================================
Alta frequência: 20-100 operações/dia em múltiplos pares.

ESTRATÉGIAS (9 total):
  1. EMA Micro (3/8/21)        — captura micro-tendências
  2. RSI Mean Reversion        — reversão em extremos
  3. Bollinger Squeeze         — breakout de volatilidade
  4. VWAP Deviation            — retorno à média institucional
  5. Volume Momentum           — spike + direcional
  6. Stochastic Oscillator     — oversold/overbought com %K/%D
  7. CCI Divergence            — Commodity Channel Index
  8. MACD Fast (3/10/5)        — versão rápida para HFT
  9. Price Action (Pinbar/Engulf) — padrões de 2 velas

PROTEÇÃO:
  - Requer 2+ estratégias concordando
  - Daily Loss Limit automático
  - Cooldown por par
  - Time-exit após 8 min
  - Max 3 posições simultâneas
"""

import logging, time, os, threading, urllib.request, json as _json
from collections import deque
from decimal import Decimal

_APP_URL = os.environ.get('APP_URL', 'http://localhost:' + os.environ.get('PORT','3000'))
_BOT_HEADER = {'Content-Type':'application/json','X-Bot-Internal':'cryptoedge-bot-2024'}

def _hft_save_open(pair, side, entry, qty, sl, tp):
    try:
        p = _json.dumps({'symbol':pair,'side':side,'entry':entry,'qty':qty,'sl':sl,'tp':tp,'strategy':'hft'}).encode()
        r = urllib.request.Request(f'{_APP_URL}/api/bot/trade/open', data=p, headers=_BOT_HEADER, method='POST')
        return _json.loads(urllib.request.urlopen(r, timeout=3).read()).get('id')
    except: return None

def _hft_save_close(tid, exit_p, pnl, reason):
    if not tid: return
    try:
        p = _json.dumps({'id':tid,'exit_price':exit_p,'pnl':pnl,'reason':reason}).encode()
        r = urllib.request.Request(f'{_APP_URL}/api/bot/trade/close', data=p, headers=_BOT_HEADER, method='POST')
        urllib.request.urlopen(r, timeout=3)
    except: pass

log = logging.getLogger('CryptoEdge.HFT')

# --- Config -------------------------------------------------------------------
HFT_TP_PCT      = float(os.environ.get('HFT_TP_PCT',     '0.35'))
HFT_SL_PCT      = float(os.environ.get('HFT_SL_PCT',     '0.18'))
HFT_RISK_PCT    = float(os.environ.get('HFT_RISK_PCT',    '1.5'))
HFT_MAX_TRADES  = int(os.environ.get('HFT_MAX_TRADES',    '3'))
HFT_DAILY_LOSS  = float(os.environ.get('HFT_DAILY_LOSS',  '3.0'))
HFT_COOLDOWN    = int(os.environ.get('HFT_COOLDOWN',      '45'))
HFT_TIME_EXIT   = int(os.environ.get('HFT_TIME_EXIT',     '480'))  # 8 min
HFT_MIN_SIGNALS = int(os.environ.get('HFT_MIN_SIGNALS',   '2'))    # mínimo de estratégias concordando
HFT_PAIRS       = [p.strip() for p in os.environ.get('HFT_PAIRS',
    'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,MATICUSDT,DOTUSDT'
).split(',') if p.strip()]
HFT_TIMEFRAME   = os.environ.get('HFT_TIMEFRAME', '1m')
HFT_MIN_VOLUME  = float(os.environ.get('HFT_MIN_VOL_USDT', '5000000'))
HFT_TESTNET     = os.environ.get('BOT_TESTNET', 'true').lower() == 'true'

# --- Engine -------------------------------------------------------------------
class HFTEngine:
    def __init__(self, capital: float, client, notify_fn=None):
        self.capital        = capital
        self.client         = client
        self.notify         = notify_fn or (lambda *a, **kw: None)
        self.running        = False
        self.positions: dict = {}
        self.trades_today: list = []
        self.daily_pnl      = 0.0
        self.daily_wins     = 0
        self.daily_losses   = 0
        self.last_trade_ts: dict = {}
        self.closes:  dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self.highs:   dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self.lows:    dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self.volumes: dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self.opens:   dict  = {p: deque(maxlen=200) for p in HFT_PAIRS}
        self._sym_info: dict = {}
        self._lock = threading.Lock()
        self.consec_losses  = 0
        self.paused_until   = 0
        # Performance tracking per pair
        self.pair_stats: dict = {p: {'wins':0,'losses':0,'pnl':0.0} for p in HFT_PAIRS}

    # --- Indicadores ----------------------------------------------------------

    def _ema(self, values, period):
        vals = list(values)
        if len(vals) < 2: return vals[-1] if vals else 0
        k = 2 / (period + 1); e = vals[0]
        for v in vals[1:]: e = v * k + e * (1 - k)
        return e

    def _rsi(self, closes, period=7):
        vals = list(closes)[-(period + 2):]
        if len(vals) < period + 1: return 50
        gains  = [max(vals[i] - vals[i-1], 0) for i in range(1, len(vals))]
        losses = [max(vals[i-1] - vals[i], 0) for i in range(1, len(vals))]
        ag = sum(gains)/len(gains); al = sum(losses)/len(losses)
        return 100 if al == 0 else 100 - (100 / (1 + ag / al))

    def _bollinger(self, closes, period=14, std=2.0):
        vals = list(closes)[-period:]
        if len(vals) < period: return None
        mid = sum(vals) / len(vals)
        sd  = (sum((v - mid)**2 for v in vals) / len(vals))**0.5
        upper = mid + std * sd; lower = mid - std * sd
        pct_b = (vals[-1] - lower) / (upper - lower) if upper != lower else 0.5
        bw    = (upper - lower) / mid * 100 if mid else 0
        return upper, mid, lower, pct_b, bw

    def _vwap(self, closes, volumes, period=20):
        c = list(closes)[-period:]; v = list(volumes)[-period:]
        if not c or not v: return c[-1] if c else 0
        tv = sum(v)
        return sum(ci*vi for ci,vi in zip(c,v)) / tv if tv > 0 else c[-1]

    def _stochastic(self, closes, highs, lows, k_period=9, d_period=3):
        """Stochastic %K e %D."""
        c = list(closes)[-k_period:]; h = list(highs)[-k_period:]; l = list(lows)[-k_period:]
        if len(c) < k_period: return 50, 50
        lowest_low  = min(l); highest_high = max(h)
        if highest_high == lowest_low: return 50, 50
        k = (c[-1] - lowest_low) / (highest_high - lowest_low) * 100
        # Smooth %D = SMA of last d_period %K values
        k_vals = []
        for i in range(d_period):
            idx = -(d_period - i)
            ci = list(closes)[idx-k_period:idx] if idx != 0 else list(closes)[-k_period:]
            hi = list(highs)[idx-k_period:idx]  if idx != 0 else list(highs)[-k_period:]
            li = list(lows)[idx-k_period:idx]   if idx != 0 else list(lows)[-k_period:]
            if not ci or not hi or not li: continue
            ll = min(li); hh = max(hi)
            if hh != ll: k_vals.append((ci[-1] - ll) / (hh - ll) * 100)
        d = sum(k_vals) / len(k_vals) if k_vals else k
        return k, d

    def _cci(self, closes, highs, lows, period=14):
        """Commodity Channel Index."""
        c = list(closes)[-period:]; h = list(highs)[-period:]; l = list(lows)[-period:]
        if len(c) < period: return 0
        typical = [(h[i] + l[i] + c[i]) / 3 for i in range(len(c))]
        mean_tp = sum(typical) / len(typical)
        mean_dev = sum(abs(t - mean_tp) for t in typical) / len(typical)
        if mean_dev == 0: return 0
        return (typical[-1] - mean_tp) / (0.015 * mean_dev)

    def _macd_fast(self, closes):
        """MACD rápido 3/10/5 para HFT."""
        vals = list(closes)
        if len(vals) < 15: return 0, 0, 0
        ef = self._ema(vals[-3:], 3); es = self._ema(vals[-10:], 10)
        ml = ef - es
        mseries = []
        for i in range(max(0, len(vals)-10), len(vals)):
            ef_i = self._ema(vals[max(0,i-3):i+1], 3)
            es_i = self._ema(vals[max(0,i-10):i+1], 10)
            mseries.append(ef_i - es_i)
        sl_val = self._ema(mseries[-5:], 5) if len(mseries) >= 5 else ml
        return ml, sl_val, ml - sl_val

    def _price_action(self, opens, closes, highs, lows):
        """Detecta pinbar e engulfing de 2 velas."""
        o = list(opens); c = list(closes); h = list(highs); l = list(lows)
        if len(c) < 2: return None
        # Pinbar
        body = abs(c[-1] - o[-1]); candle_range = h[-1] - l[-1]
        if candle_range > 0:
            upper_wick = h[-1] - max(c[-1], o[-1])
            lower_wick = min(c[-1], o[-1]) - l[-1]
            if lower_wick > body * 2 and lower_wick > upper_wick * 2: return 'BUY'   # hammer
            if upper_wick > body * 2 and upper_wick > lower_wick * 2: return 'SELL'  # shooting star
        # Engulfing
        prev_body = abs(c[-2] - o[-2])
        if body > prev_body * 1.5:
            if c[-1] > o[-1] and c[-2] < o[-2]: return 'BUY'   # bullish engulf
            if c[-1] < o[-1] and c[-2] > o[-2]: return 'SELL'  # bearish engulf
        return None

    def _atr(self, highs, lows, closes, period=7):
        h = list(highs)[-(period+1):]; l = list(lows)[-(period+1):]; c = list(closes)[-(period+1):]
        if len(c) < 2: return 0
        trs = [max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])) for i in range(1, len(c))]
        return sum(trs) / len(trs) if trs else 0

    # --- Sinal principal — combina 9 estratégias ------------------------------

    def _generate_signal(self, pair: str) -> dict:
        closes  = self.closes[pair]
        highs   = self.highs[pair]
        lows    = self.lows[pair]
        volumes = self.volumes[pair]
        opens   = self.opens[pair]

        if len(closes) < 30: return {'side': None, 'score': 0, 'reason': 'aguardando dados'}

        close   = closes[-1]
        signals = []  # (side, reason, weight)

        # -- 1. EMA Micro (3/8/21) ---------------------------------------------
        ema3  = self._ema(list(closes)[-3:],  3)
        ema8  = self._ema(list(closes)[-8:],  8)
        ema21 = self._ema(list(closes)[-21:], 21)
        if ema3 > ema8 * 1.0001 and ema8 > ema21 * 0.9998:
            signals.append(('BUY',  'EMA micro bull', 1.0))
        elif ema3 < ema8 * 0.9999 and ema8 < ema21 * 1.0002:
            signals.append(('SELL', 'EMA micro bear', 1.0))

        # -- 2. RSI Extremo (período 7) ---------------------------------------
        rsi_val = self._rsi(closes)
        if   rsi_val < 30: signals.append(('BUY',  f'RSI oversold {rsi_val:.0f}',  1.5))
        elif rsi_val < 40: signals.append(('BUY',  f'RSI low {rsi_val:.0f}',       0.8))
        elif rsi_val > 70: signals.append(('SELL', f'RSI overbought {rsi_val:.0f}',1.5))
        elif rsi_val > 60: signals.append(('SELL', f'RSI high {rsi_val:.0f}',      0.8))

        # -- 3. Bollinger Bands -----------------------------------------------
        bb = self._bollinger(closes)
        if bb:
            upper, mid, lower, pct_b, bw = bb
            if   pct_b < 0.08 and bw > 0.15: signals.append(('BUY',  f'BB lower {pct_b:.2f}', 1.2))
            elif pct_b < 0.20 and bw > 0.10: signals.append(('BUY',  f'BB near lower',        0.7))
            elif pct_b > 0.92 and bw > 0.15: signals.append(('SELL', f'BB upper {pct_b:.2f}', 1.2))
            elif pct_b > 0.80 and bw > 0.10: signals.append(('SELL', f'BB near upper',        0.7))

        # -- 4. VWAP Deviation -----------------------------------------------
        vwap = self._vwap(closes, volumes)
        dev  = (close - vwap) / vwap * 100 if vwap else 0
        if   dev < -0.30: signals.append(('BUY',  f'VWAP dev {dev:.2f}%', 1.2))
        elif dev < -0.15: signals.append(('BUY',  f'VWAP slight {dev:.2f}%', 0.7))
        elif dev >  0.30: signals.append(('SELL', f'VWAP dev +{dev:.2f}%', 1.2))
        elif dev >  0.15: signals.append(('SELL', f'VWAP slight +{dev:.2f}%', 0.7))

        # -- 5. Volume Momentum -----------------------------------------------
        vols = list(volumes)
        if len(vols) >= 6:
            avg_vol  = sum(vols[-6:-1]) / 5
            last_vol = vols[-1]
            if avg_vol > 0 and last_vol > avg_vol * 1.4:
                cls = list(closes)
                if cls[-1] > cls[-2] * 1.001:
                    signals.append(('BUY',  f'Vol spike {last_vol/avg_vol:.1f}x↑', 1.3))
                elif cls[-1] < cls[-2] * 0.999:
                    signals.append(('SELL', f'Vol spike {last_vol/avg_vol:.1f}x↓', 1.3))

        # -- 6. Stochastic ---------------------------------------------------
        if len(closes) >= 12:
            stk, std = self._stochastic(closes, highs, lows)
            if   stk < 25 and std < 30:
                signals.append(('BUY',  f'Stoch oversold K={stk:.0f}', 1.1))
            elif stk > 75 and std > 70:
                signals.append(('SELL', f'Stoch overbought K={stk:.0f}', 1.1))

        # -- 7. CCI ----------------------------------------------------------
        if len(closes) >= 14:
            cci_val = self._cci(closes, highs, lows)
            if   cci_val < -80:  signals.append(('BUY',  f'CCI {cci_val:.0f} oversold', 1.0))
            elif cci_val >  80:  signals.append(('SELL', f'CCI {cci_val:.0f} overbought', 1.0))

        # -- 8. MACD Fast (3/10/5) -------------------------------------------
        if len(closes) >= 15:
            ml, sl, hist = self._macd_fast(closes)
            prev_hist = list(closes)  # need previous candle
            if hist > 0 and hist > abs(ml) * 0.1:
                signals.append(('BUY',  f'MACD fast cross↑ {hist:.4f}', 0.9))
            elif hist < 0 and abs(hist) > abs(ml) * 0.1:
                signals.append(('SELL', f'MACD fast cross↓ {hist:.4f}', 0.9))

        # -- 9. Price Action (Pinbar / Engulfing) ----------------------------
        if len(opens) >= 2:
            pa = self._price_action(opens, closes, highs, lows)
            if pa == 'BUY':
                signals.append(('BUY',  'Pinbar/Engulf bullish', 1.4))
            elif pa == 'SELL':
                signals.append(('SELL', 'Pinbar/Engulf bearish', 1.4))

        # -- Consolidar com peso ----------------------------------------------
        buy_score  = sum(w for s, r, w in signals if s == 'BUY')
        sell_score = sum(w for s, r, w in signals if s == 'SELL')
        buy_count  = sum(1 for s, r, w in signals if s == 'BUY')
        sell_count = sum(1 for s, r, w in signals if s == 'SELL')

        # Detectar divergência (não entra se score dividido)
        if buy_score > 0 and sell_score > 0:
            if buy_score / (buy_score + sell_score) < 0.70 and sell_score / (buy_score + sell_score) < 0.70:
                return {'side': None, 'score': 0, 'reason': f'divergência (B:{buy_score:.1f} S:{sell_score:.1f})'}

        reasons_buy  = [r for s, r, w in signals if s == 'BUY'][:3]
        reasons_sell = [r for s, r, w in signals if s == 'SELL'][:3]

        if buy_count >= HFT_MIN_SIGNALS and buy_score > sell_score * 1.3:
            return {'side': 'BUY',  'score': buy_score,  'count': buy_count,
                    'reason': ' + '.join(reasons_buy), 'rsi': rsi_val, 'price': close}
        if sell_count >= HFT_MIN_SIGNALS and sell_score > buy_score * 1.3:
            return {'side': 'SELL', 'score': sell_score, 'count': sell_count,
                    'reason': ' + '.join(reasons_sell), 'rsi': rsi_val, 'price': close}

        return {'side': None, 'score': 0, 'reason': f'sem consenso (B:{buy_count} S:{sell_count})'}

    # --- Gestão de ordens -----------------------------------------------------

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
                log.warning(f'  HFT: sym_info {pair} erro: {e}')
                self._sym_info[pair] = {'min_qty': 0.001, 'step': 0.001, 'min_notional': 10.0}
        return self._sym_info[pair]

    def _round_step(self, v, step):
        step_d = Decimal(str(step)).normalize()
        v_d    = Decimal(str(v))
        qty_d  = (v_d // step_d) * step_d
        sign, digits, exp = step_d.as_tuple()
        prec = max(0, -exp)
        return float(round(qty_d, prec))

    def _calc_qty(self, pair: str, price: float) -> float:
        if price <= 0: return 0
        info   = self._get_sym_info(pair)
        budget = self.capital * (HFT_RISK_PCT / 100)
        qty    = self._round_step(budget / price, info['step'])
        if qty < info['min_qty']:
            qty = self._round_step(info['min_notional'] / price * 1.05, info['step'])
        return qty if qty >= info['min_qty'] else 0

    def _open_position(self, pair: str, side: str, price: float, reason: str) -> bool:
        qty = self._calc_qty(pair, price)
        if qty <= 0: return False

        # Dynamic TP/SL based on ATR when available
        atr_val = self._atr(self.highs[pair], self.lows[pair], self.closes[pair])
        tp_dist = max(atr_val * 1.5, price * HFT_TP_PCT / 100)
        sl_dist = max(atr_val * 0.8, price * HFT_SL_PCT / 100)

        if side == 'BUY':
            tp = price + tp_dist; sl = price - sl_dist
        else:
            tp = price - tp_dist; sl = price + sl_dist

        tp_pct = abs(tp - price) / price * 100
        sl_pct = abs(sl - price) / price * 100

        from binance.enums import SIDE_BUY, SIDE_SELL, ORDER_TYPE_MARKET
        b_side = SIDE_BUY if side == 'BUY' else SIDE_SELL

        try:
            if HFT_TESTNET:
                log.info(f'  [TESTNET] HFT {pair} {side} {qty:.6f} @ ${price:,.4f} | TP ${tp:,.4f} | SL ${sl:,.4f}')
                order_id = int(time.time())
            else:
                order = self.client.create_order(
                    symbol=pair, side=b_side, type=ORDER_TYPE_MARKET, quantity=qty)
                order_id = order.get('orderId', 0)
                fills = order.get('fills', [])
                if fills: price = sum(float(f['price'])*float(f['qty']) for f in fills) / sum(float(f['qty']) for f in fills)

            key = f'{pair}_{int(time.time()*1000)}'
            self.positions[key] = {
                'pair': pair, 'side': side, 'entry': price, 'qty': qty,
                'sl': sl, 'tp': tp, 'opened_at': time.time(),
                'order_id': order_id, 'reason': reason, 'db_id': None
            }
            self.last_trade_ts[pair] = time.time()
            rr = tp_pct / sl_pct if sl_pct > 0 else 0
            log.info(f'  ⚡ HFT {side} {pair} @ ${price:,.4f} | TP +{tp_pct:.2f}% | SL -{sl_pct:.2f}% | R:R 1:{rr:.1f} | {reason}')
            # Save trade to DB for equity curve
            self.positions[key]['db_id'] = _hft_save_open(pair, side, price, qty, sl, tp)
            self.notify(
                f'⚡ <b>HFT {side} — {pair}</b>\n'
                f'💲 <code>${price:,.4f}</code>  🎯 <code>${tp:,.4f}</code> (+{tp_pct:.2f}%)  🛡 <code>${sl:,.4f}</code> (-{sl_pct:.2f}%)\n'
                f'📦 {qty} | ⚖️ 1:{rr:.1f} | {reason}'
            )
            return True
        except Exception as e:
            log.error(f'  ❌ HFT {pair} {side}: {e}')
            return False

    def _close_position(self, key: str, price: float, reason: str):
        pos = self.positions.get(key)
        if not pos: return
        pair = pos['pair']; side = pos['side']; qty = pos['qty']

        from binance.enums import SIDE_BUY, SIDE_SELL, ORDER_TYPE_MARKET
        close_side = SIDE_SELL if side == 'BUY' else SIDE_BUY

        try:
            if not HFT_TESTNET:
                self.client.create_order(symbol=pair, side=close_side, type=ORDER_TYPE_MARKET, quantity=qty)
        except Exception as e:
            log.error(f'  ❌ HFT close {pair}: {e}')

        pnl = (price - pos['entry']) * qty if side == 'BUY' else (pos['entry'] - price) * qty
        self.daily_pnl += pnl
        duration = time.time() - pos['opened_at']
        win = pnl > 0
        if win:  self.daily_wins   += 1; self.consec_losses = 0; icon = '✅'
        else:    self.daily_losses += 1; self.consec_losses += 1; icon = '❌'

        if pair in self.pair_stats:
            s = self.pair_stats[pair]
            if win: s['wins'] += 1
            else:   s['losses'] += 1
            s['pnl'] += pnl

        self.trades_today.append({
            'pair': pair, 'side': side, 'entry': pos['entry'], 'exit': price,
            'qty': qty, 'pnl': pnl, 'duration': duration, 'reason': reason, 'ts': time.time()
        })
        # Save close to DB for equity curve
        _hft_save_close(pos.get('db_id'), price, pnl, reason)
        del self.positions[key]

        total = self.daily_wins + self.daily_losses
        wr    = self.daily_wins / total * 100 if total else 0
        log.info(f'  {icon} HFT FECHA {pair} | ${pnl:+.4f} | {int(duration)}s | {reason} | Hoje: {total}T WR:{wr:.0f}% PnL:${self.daily_pnl:+.4f}')
        self.notify(
            f'{icon} <b>HFT fechou {pair}</b> P&L: <code>${pnl:+.4f}</code> ({int(duration)}s)\n'
            f'📊 Hoje: {total} trades | WR:{wr:.0f}% | PnL total: <code>${self.daily_pnl:+.4f}</code>'
        )

        if self.consec_losses >= 3:
            pause = HFT_COOLDOWN * self.consec_losses
            self.paused_until = time.time() + pause
            log.warning(f'  ⏸ HFT: {self.consec_losses} losses → pausa {pause}s')
            self.notify(f'⏸ <b>HFT pausado {pause}s</b> ({self.consec_losses} losses seguidos)')

    def _check_exit(self, pair: str, price: float):
        for key, pos in list(self.positions.items()):
            if pos['pair'] != pair: continue
            side = pos['side']
            age  = time.time() - pos['opened_at']
            if side == 'BUY':
                if price >= pos['tp']: self._close_position(key, price, f'TP +{(price/pos["entry"]-1)*100:.2f}%')
                elif price <= pos['sl']: self._close_position(key, price, f'SL -{(1-price/pos["entry"])*100:.2f}%')
                elif age > HFT_TIME_EXIT and price > pos['entry']: self._close_position(key, price, f'Time-exit profit')
                elif age > HFT_TIME_EXIT * 2: self._close_position(key, price, f'Time-exit max')
            else:
                if price <= pos['tp']: self._close_position(key, price, f'TP +{(pos["entry"]/price-1)*100:.2f}%')
                elif price >= pos['sl']: self._close_position(key, price, f'SL -{(price/pos["entry"]-1)*100:.2f}%')
                elif age > HFT_TIME_EXIT and price < pos['entry']: self._close_position(key, price, f'Time-exit profit')
                elif age > HFT_TIME_EXIT * 2: self._close_position(key, price, f'Time-exit max')


    def _poll_close_flags(self, pair: str, close: float):
        import os as _os
        # Check pair-based flag (fastest path)
        pair_flag = f'/tmp/hft_close_pair_{pair}'
        if _os.path.exists(pair_flag):
            try: _os.remove(pair_flag)
            except: pass
            self.close_position_by_pair(pair, 'Manual close via painel')
            return
        # Check id-based flags
        import glob as _glob
        for fpath in _glob.glob('/tmp/hft_close_*'):
            if '_pair_' in fpath: continue
            try:
                import json as _json
                data = _json.loads(open(fpath).read())
                if data.get('pair') == pair or not data.get('pair'):
                    db_id = data.get('trade_id', '')
                    _os.remove(fpath)
                    if db_id:
                        if not self.close_position_by_id(db_id, 'Manual close via painel'):
                            self.close_position_by_pair(pair, 'Manual close via painel')
                    else:
                        self.close_position_by_pair(pair, 'Manual close via painel')
            except: pass

    def close_position_by_pair(self, pair: str, reason: str = 'Manual close via painel') -> bool:
        """Close the first open position for a given pair. Called by manual close endpoint."""
        closed = False
        for key, pos in list(self.positions.items()):
            if pos['pair'] == pair:
                cur_price = list(self.closes.get(pair, [pos['entry']]))[-1]
                log.info(f'  🖐 HFT manual close: {pair} {pos["side"]} @ ${cur_price:,.4f}')
                self._close_position(key, cur_price, reason)
                closed = True
                break
        return closed

    def close_position_by_id(self, db_id: str, reason: str = 'Manual close via painel') -> bool:
        """Close position by DB trade id."""
        for key, pos in list(self.positions.items()):
            if pos.get('db_id') == db_id or key == db_id:
                cur_price = list(self.closes.get(pos['pair'], [pos['entry']]))[-1]
                log.info(f'  🖐 HFT manual close by id: {pos["pair"]} @ ${cur_price:,.4f}')
                self._close_position(key, cur_price, reason)
                return True
        return False

    def on_candle(self, pair: str, open_: float, high: float, low: float,
                  close: float, volume: float, is_closed: bool):
        # Init deques para par novo
        if pair not in self.closes:
            self.closes[pair]  = deque(maxlen=200)
            self.highs[pair]   = deque(maxlen=200)
            self.lows[pair]    = deque(maxlen=200)
            self.volumes[pair] = deque(maxlen=200)
            self.opens[pair]   = deque(maxlen=200)

        # Checa SL/TP em cada tick
        self._check_exit(pair, close)
        # Check manual close requests every tick
        self._poll_close_flags(pair, close)

        # SOMENTE em velas FECHADAS atualiza os dados históricos e gera sinais
        # Ticks intermediários contaminariam RSI/EMA/BB com dados repetidos
        if not is_closed: return

        # Vela fechada: registra OHLCV definitivo
        self.closes[pair].append(close)
        self.highs[pair].append(high)
        self.lows[pair].append(low)
        self.volumes[pair].append(volume)
        self.opens[pair].append(open_)

        now = time.time()

        # Guards
        if not self.running: return
        if self.paused_until > now: return
        daily_loss_pct = abs(self.daily_pnl) / self.capital * 100 if self.daily_pnl < 0 else 0
        if daily_loss_pct >= HFT_DAILY_LOSS:
            if self.running:
                self.running = False
                self.notify(f'🛑 <b>HFT Daily Loss {HFT_DAILY_LOSS}% atingido</b> | PnL: ${self.daily_pnl:.4f}\nBot pausado até amanhã.')
            return
        if now - self.last_trade_ts.get(pair, 0) < HFT_COOLDOWN: return
        if sum(1 for k in self.positions if k.startswith(pair)) >= 1: return
        if len(self.positions) >= HFT_MAX_TRADES: return

        with self._lock:
            sig = self._generate_signal(pair)

        if sig['side']:
            log.info(f'  📡 HFT SINAL {sig["side"]} {pair} score={sig["score"]:.1f} ({sig.get("count",0)} sinais) | {sig["reason"]}')
            self._open_position(pair, sig['side'], close, sig['reason'])
        else:
            # Log a cada 15 velas fechadas para confirmar que está vivo e monitorando
            n_closes = len(self.closes.get(pair, []))
            if n_closes > 0 and n_closes % 15 == 0:
                rsi_val = self._rsi(self.closes[pair]) if n_closes >= 9 else 50
                n_pos = len(self.positions)
                log.info(f'  📊 HFT {pair} | velas={n_closes} RSI={rsi_val:.0f} | {sig["reason"]} | posições abertas: {n_pos}')

    def get_stats(self) -> dict:
        total = self.daily_wins + self.daily_losses
        return {
            'daily_pnl':   round(self.daily_pnl, 4),
            'daily_wins':  self.daily_wins,
            'daily_losses':self.daily_losses,
            'win_rate':    round(self.daily_wins / total * 100, 1) if total else 0,
            'total_trades':total,
            'open_positions': len(self.positions),
            'pairs':       list(set(p['pair'] for p in self.positions.values())),
            'pair_stats':  self.pair_stats,
            'consec_losses': self.consec_losses,
        }

    def send_daily_summary(self):
        total = self.daily_wins + self.daily_losses
        wr    = self.daily_wins / total * 100 if total > 0 else 0
        # top pair by pnl
        top_pairs = sorted(self.pair_stats.items(), key=lambda x: x[1]['pnl'], reverse=True)
        pair_lines = '\n'.join(
            f"  {'✅' if s['pnl']>=0 else '❌'} {p.replace('USDT',''):6} "
            f"{s['wins']}W/{s['losses']}L  "
            f"{'+'if s['pnl']>=0 else ''}${s['pnl']:.4f}"
            for p, s in top_pairs[:6] if s['wins']+s['losses'] > 0
        ) or '  Nenhum trade hoje'
        pnl_icon = '🟢' if self.daily_pnl >= 0 else '🔴'
        self.notify(
            f'📊 <b>Resumo Diário HFT</b>\n'
            f'{'-'*28}\n'
            f'{pnl_icon} PnL: <code>{"+"if self.daily_pnl>=0 else ""}${self.daily_pnl:.4f}</code>\n'
            f'📈 Trades: <code>{total}</code> ({self.daily_wins}W/{self.daily_losses}L)\n'
            f'🎯 Win Rate: <code>{wr:.1f}%</code>\n'
            f'{'-'*28}\n'
            f'<b>Por par:</b>\n{pair_lines}\n'
            f'{'-'*28}\n'
            f'🕐 <i>{__import__("datetime").datetime.now().strftime("%d/%m/%Y %H:%M")}</i>'
        )

    def reset_daily(self):
        log.info(f'  🔄 HFT reset diário | Fechando {len(self.positions)} posições')
        # Send summary before reset
        if self.daily_wins + self.daily_losses > 0:
            try: self.send_daily_summary()
            except: pass
        self.daily_pnl = 0.0; self.daily_wins = 0; self.daily_losses = 0
        self.trades_today = []; self.consec_losses = 0; self.paused_until = 0
        self.pair_stats = {p: {'wins':0,'losses':0,'pnl':0.0} for p in HFT_PAIRS}
        self.running = True
        log.info('  ✅ HFT novo dia iniciado')


# --- Singleton ----------------------------------------------------------------
_hft_engine: HFTEngine = None

def get_hft_engine() -> HFTEngine: return _hft_engine
def init_hft(capital, client, notify_fn=None) -> HFTEngine:
    global _hft_engine
    _hft_engine = HFTEngine(capital, client, notify_fn)
    _hft_engine.running = True
    return _hft_engine
