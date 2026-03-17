"""
CryptoEdge Pro — HFT Engine v3.0  ⚡ ADAPTIVE LEARNING EDITION
================================================================
Alta frequência: 20-100 operações/dia em múltiplos pares.

NOVIDADES v3.0:
  ✅ Sistema de Aprendizado Adaptativo por estratégia e por par
  ✅ Detecção de Regime de Mercado (Trending / Ranging / Choppy)
  ✅ Filtro de Sessão (horários de alto volume)
  ✅ Trail Stop automático (SL move para break-even após 50% do TP)
  ✅ R:R mínimo de 1.5:1 garantido
  ✅ Score mínimo elevado + mínimo de 3 estratégias concordando
  ✅ Pesos dinâmicos por estratégia baseados em win rate histórico
  ✅ Persistência do aprendizado entre sessões (JSON)
  ✅ Position sizing dinâmico baseado em confiança do sinal
  ✅ Filtro de tendência (EMA 50) - evita operar contra a macro
  ✅ Proteção contra mercado lateralizado (ADX mínimo)
  ✅ Resumo diário com analise de performance por estrategia

ESTRATÉGIAS (9 + pesos adaptativos):
  1. EMA Micro (3/8/21)         — micro-tendências
  2. RSI Mean Reversion         — extremos de RSI
  3. Bollinger Squeeze          — breakout de volatilidade
  4. VWAP Deviation             — retorno à média institucional
  5. Volume Momentum            — spike direcional de volume
  6. Stochastic Oscillator      — %K/%D oversold/overbought
  7. CCI Divergence             — Commodity Channel Index
  8. MACD Fast (3/10/5)         — versão rápida HFT
  9. Price Action               — Pinbar / Engulfing

PROTEÇÕES:
  - Min 3 estratégias concordando (era 2)
  - Score mínimo ponderado >= 3.0 (adapta por regime)
  - R:R mínimo 1.5:1
  - Trail stop automático (BE após 50% TP)
  - Daily Loss Limit automático
  - Cooldown dinâmico (maior após losses)
  - Max 3 posições simultâneas (1 por par)
  - Time-exit com análise de PnL
  - Filtro de regime (sem entradas em mercado choppy)
"""

import logging, time, os, threading, urllib.request, json as _json, math
from collections import deque
from decimal import Decimal
import datetime

_APP_URL    = os.environ.get('APP_URL', 'http://localhost:' + os.environ.get('PORT', '3000'))
_BOT_HEADER = {'Content-Type': 'application/json', 'X-Bot-Internal': 'cryptoedge-bot-2024'}

# Persistência de aprendizado
_LEARN_FILE = os.environ.get('HFT_LEARN_FILE', '/data/hft_learn.json')

def _load_learning():
    try:
        if os.path.exists(_LEARN_FILE):
            with open(_LEARN_FILE, 'r') as f:
                return _json.load(f)
    except Exception:
        pass
    return {}

def _save_learning(data):
    try:
        os.makedirs(os.path.dirname(_LEARN_FILE), exist_ok=True)
        with open(_LEARN_FILE, 'w') as f:
            _json.dump(data, f)
    except Exception:
        pass

def _hft_save_open(pair, side, entry, qty, sl, tp):
    try:
        p = _json.dumps({'symbol': pair, 'side': side, 'entry': entry,
                         'qty': qty, 'sl': sl, 'tp': tp, 'strategy': 'hft'}).encode()
        r = urllib.request.Request(f'{_APP_URL}/api/bot/trade/open', data=p,
                                   headers=_BOT_HEADER, method='POST')
        return _json.loads(urllib.request.urlopen(r, timeout=3).read()).get('id')
    except:
        return None

def _hft_save_close(tid, exit_p, pnl, reason):
    if not tid: return
    try:
        p = _json.dumps({'id': tid, 'exit_price': exit_p, 'pnl': pnl, 'reason': reason}).encode()
        r = urllib.request.Request(f'{_APP_URL}/api/bot/trade/close', data=p,
                                   headers=_BOT_HEADER, method='POST')
        urllib.request.urlopen(r, timeout=3)
    except:
        pass

log = logging.getLogger('CryptoEdge.HFT')

# Config via env
HFT_TP_PCT       = float(os.environ.get('HFT_TP_PCT',      '0.40'))
HFT_SL_PCT       = float(os.environ.get('HFT_SL_PCT',      '0.20'))
HFT_RISK_PCT     = float(os.environ.get('HFT_RISK_PCT',    '1.5'))
HFT_MAX_TRADES   = int(os.environ.get('HFT_MAX_TRADES',    '3'))
HFT_DAILY_LOSS   = float(os.environ.get('HFT_DAILY_LOSS',  '3.0'))
HFT_COOLDOWN     = int(os.environ.get('HFT_COOLDOWN',      '45'))
HFT_TIME_EXIT    = int(os.environ.get('HFT_TIME_EXIT',     '480'))
HFT_MIN_SIGNALS  = int(os.environ.get('HFT_MIN_SIGNALS',   '3'))
HFT_PAIRS        = [p.strip() for p in os.environ.get('HFT_PAIRS',
    'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,MATICUSDT,DOTUSDT'
).split(',') if p.strip()]
HFT_TIMEFRAME    = os.environ.get('HFT_TIMEFRAME', '1m')
HFT_MIN_VOLUME   = float(os.environ.get('HFT_MIN_VOL_USDT', '5000000'))
HFT_TESTNET      = os.environ.get('BOT_TESTNET', 'true').lower() == 'true'
HFT_MIN_RR       = float(os.environ.get('HFT_MIN_RR',      '1.5'))
HFT_SESSION_FILTER = os.environ.get('HFT_SESSION_FILTER', 'false').lower() == 'true'

STRATEGY_NAMES = [
    'ema_micro', 'rsi_reversion', 'bollinger', 'vwap_dev',
    'volume_mom', 'stochastic', 'cci', 'macd_fast', 'price_action'
]

BASE_WEIGHTS = {
    'ema_micro':    1.0,
    'rsi_reversion':1.5,
    'bollinger':    1.2,
    'vwap_dev':     1.2,
    'volume_mom':   1.3,
    'stochastic':   1.1,
    'cci':          1.0,
    'macd_fast':    0.9,
    'price_action': 1.4,
}

# ─────────────────────────────────────────────────────────────────────────────
class AdaptiveLearner:
    """
    Aprende com erros, reforça acertos.
    Ajusta pesos de cada estratégia com base no histórico de trades.
    win_rate 50% = peso normal | 70% = +40% | 30% = -40%
    """
    WINDOW = 60

    def __init__(self):
        self._lock = threading.Lock()
        data = _load_learning()
        self._global = {}
        self._per_pair = {}
        for s in STRATEGY_NAMES:
            hist = data.get('global', {}).get(s, [])
            self._global[s] = deque(hist[-self.WINDOW:], maxlen=self.WINDOW)
        for pair in HFT_PAIRS:
            self._per_pair[pair] = {}
            for s in STRATEGY_NAMES:
                hist = data.get('pairs', {}).get(pair, {}).get(s, [])
                self._per_pair[pair][s] = deque(hist[-self.WINDOW:], maxlen=self.WINDOW)
        total_records = sum(len(v) for v in self._global.values())
        log.info(f'  🧠 AdaptiveLearner: {total_records} registros históricos carregados')

    def record(self, pair, strategies_used, win):
        outcome = 1 if win else 0
        with self._lock:
            for s in strategies_used:
                if s in self._global:
                    self._global[s].append(outcome)
                if pair in self._per_pair and s in self._per_pair[pair]:
                    self._per_pair[pair][s].append(outcome)
        self._persist()

    def _win_rate(self, history):
        if len(history) < 5:
            return 0.5
        return sum(history) / len(history)

    def get_weight(self, pair, strategy):
        base = BASE_WEIGHTS.get(strategy, 1.0)
        with self._lock:
            wr_global = self._win_rate(self._global.get(strategy, deque()))
            pp        = self._per_pair.get(pair, {})
            wr_pair   = self._win_rate(pp.get(strategy, deque()))
            n_global  = len(self._global.get(strategy, deque()))
            n_pair    = len(pp.get(strategy, deque()))
        if n_pair < 5:
            combined_wr = wr_global
        elif n_global < 5:
            combined_wr = wr_pair
        else:
            combined_wr = 0.4 * wr_global + 0.6 * wr_pair
        # factor: wr=50%→1.0x, wr=70%→1.4x, wr=30%→0.6x
        factor = max(0.5, min(2.0, 0.2 + combined_wr * 1.6))
        return base * factor

    def get_summary(self):
        result = {}
        for s in STRATEGY_NAMES:
            with self._lock:
                hist = self._global.get(s, deque())
                n    = len(hist)
                wr   = self._win_rate(hist) * 100 if n >= 5 else None
            result[s] = {'n': n, 'wr': round(wr, 1) if wr is not None else 'N/A'}
        return result

    def _persist(self):
        try:
            data = {
                'global': {s: list(self._global[s]) for s in STRATEGY_NAMES},
                'pairs':  {
                    p: {s: list(self._per_pair[p][s]) for s in STRATEGY_NAMES}
                    for p in self._per_pair
                },
                'saved_at': datetime.datetime.now().isoformat()
            }
            _save_learning(data)
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
class HFTEngine:
    def __init__(self, capital, client, notify_fn=None):
        self.capital         = capital
        self.client          = client
        self.notify          = notify_fn or (lambda *a, **kw: None)
        self.running         = False
        self.positions       = {}
        self.trades_today    = []
        self.daily_pnl       = 0.0
        self.daily_wins      = 0
        self.daily_losses    = 0
        self.last_trade_ts   = {}
        self.closes          = {p: deque(maxlen=250) for p in HFT_PAIRS}
        self.highs           = {p: deque(maxlen=250) for p in HFT_PAIRS}
        self.lows            = {p: deque(maxlen=250) for p in HFT_PAIRS}
        self.volumes         = {p: deque(maxlen=250) for p in HFT_PAIRS}
        self.opens           = {p: deque(maxlen=250) for p in HFT_PAIRS}
        self._sym_info       = {}
        self._lock           = threading.Lock()
        self.consec_losses   = 0
        self.consec_wins     = 0
        self.paused_until    = 0
        self.pair_stats      = {p: {'wins': 0, 'losses': 0, 'pnl': 0.0} for p in HFT_PAIRS}
        self.strategy_stats  = {s: {'wins': 0, 'losses': 0} for s in STRATEGY_NAMES}
        self.learner         = AdaptiveLearner()
        log.info('  🚀 HFT Engine v3.0 ADAPTIVE iniciado')

    # ── Indicadores ──────────────────────────────────────────────────────────

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
        ag = sum(gains) / len(gains); al = sum(losses) / len(losses)
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
        return sum(ci * vi for ci, vi in zip(c, v)) / tv if tv > 0 else c[-1]

    def _stochastic(self, closes, highs, lows, k_period=9, d_period=3):
        c = list(closes)[-k_period:]; h = list(highs)[-k_period:]; l = list(lows)[-k_period:]
        if len(c) < k_period: return 50, 50
        ll = min(l); hh = max(h)
        if hh == ll: return 50, 50
        k = (c[-1] - ll) / (hh - ll) * 100
        k_vals = []
        for i in range(d_period):
            idx = -(d_period - i)
            ci = list(closes)[idx-k_period:idx] if idx != 0 else list(closes)[-k_period:]
            hi = list(highs)[idx-k_period:idx]  if idx != 0 else list(highs)[-k_period:]
            li = list(lows)[idx-k_period:idx]   if idx != 0 else list(lows)[-k_period:]
            if not ci or not hi or not li: continue
            ll2 = min(li); hh2 = max(hi)
            if hh2 != ll2: k_vals.append((ci[-1] - ll2) / (hh2 - ll2) * 100)
        d = sum(k_vals) / len(k_vals) if k_vals else k
        return k, d

    def _cci(self, closes, highs, lows, period=14):
        c = list(closes)[-period:]; h = list(highs)[-period:]; l = list(lows)[-period:]
        if len(c) < period: return 0
        typical  = [(h[i] + l[i] + c[i]) / 3 for i in range(len(c))]
        mean_tp  = sum(typical) / len(typical)
        mean_dev = sum(abs(t - mean_tp) for t in typical) / len(typical)
        if mean_dev == 0: return 0
        return (typical[-1] - mean_tp) / (0.015 * mean_dev)

    def _macd_fast(self, closes):
        vals = list(closes)
        if len(vals) < 15: return 0, 0, 0
        ef = self._ema(vals[-3:], 3); es = self._ema(vals[-10:], 10)
        ml = ef - es
        mseries = []
        for i in range(max(0, len(vals)-10), len(vals)):
            ef_i = self._ema(vals[max(0, i-3):i+1], 3)
            es_i = self._ema(vals[max(0, i-10):i+1], 10)
            mseries.append(ef_i - es_i)
        sl_val = self._ema(mseries[-5:], 5) if len(mseries) >= 5 else ml
        return ml, sl_val, ml - sl_val

    def _price_action(self, opens, closes, highs, lows):
        o = list(opens); c = list(closes); h = list(highs); l = list(lows)
        if len(c) < 2: return None
        body = abs(c[-1] - o[-1]); rng = h[-1] - l[-1]
        if rng > 0:
            upper_wick = h[-1] - max(c[-1], o[-1])
            lower_wick = min(c[-1], o[-1]) - l[-1]
            if lower_wick > body * 2 and lower_wick > upper_wick * 2: return 'BUY'
            if upper_wick > body * 2 and upper_wick > lower_wick * 2: return 'SELL'
        prev_body = abs(c[-2] - o[-2])
        if body > prev_body * 1.5:
            if c[-1] > o[-1] and c[-2] < o[-2]: return 'BUY'
            if c[-1] < o[-1] and c[-2] > o[-2]: return 'SELL'
        return None

    def _atr(self, highs, lows, closes, period=7):
        h = list(highs)[-(period+1):]; l = list(lows)[-(period+1):]; c = list(closes)[-(period+1):]
        if len(c) < 2: return 0
        trs = [max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])) for i in range(1, len(c))]
        return sum(trs) / len(trs) if trs else 0

    def _adx(self, highs, lows, closes, period=14):
        h = list(highs); l = list(lows); c = list(closes)
        if len(c) < period + 2: return 0
        dm_p = []; dm_n = []; tr_l = []
        for i in range(1, len(c)):
            up = h[i] - h[i-1]; dn = l[i-1] - l[i]
            dm_p.append(up if up > dn and up > 0 else 0)
            dm_n.append(dn if dn > up and dn > 0 else 0)
            tr_l.append(max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])))
        atr_v = sum(tr_l[-period:]) / period
        if atr_v == 0: return 0
        pdi = 100 * sum(dm_p[-period:]) / period / atr_v
        ndi = 100 * sum(dm_n[-period:]) / period / atr_v
        dx  = 100 * abs(pdi - ndi) / (pdi + ndi) if (pdi + ndi) > 0 else 0
        return round(dx, 1)

    # ── Regime de Mercado ─────────────────────────────────────────────────────

    def _detect_regime(self, pair):
        closes = self.closes[pair]; highs = self.highs[pair]; lows = self.lows[pair]
        if len(closes) < 50: return 'ranging'
        adx_val = self._adx(highs, lows, closes, period=14)
        ema21   = self._ema(list(closes)[-21:], 21)
        ema50   = self._ema(list(closes)[-50:], 50)
        close   = closes[-1]
        bb = self._bollinger(closes, period=20)
        bw = bb[4] if bb else 0.5
        if adx_val > 25:
            if close > ema21 > ema50: return 'trending_up'
            if close < ema21 < ema50: return 'trending_down'
        if bw < 0.08: return 'choppy'
        return 'ranging'

    # ── Filtro de Sessão ─────────────────────────────────────────────────────

    def _in_active_session(self):
        if not HFT_SESSION_FILTER: return True
        h = datetime.datetime.utcnow().hour
        return (0 <= h < 4) or (7 <= h < 12) or (13 <= h < 21)

    # ── Sinal com Pesos Adaptativos ───────────────────────────────────────────

    def _generate_signal(self, pair):
        closes = self.closes[pair]; highs = self.highs[pair]
        lows   = self.lows[pair];   volumes = self.volumes[pair]
        opens  = self.opens[pair]
        if len(closes) < 30:
            return {'side': None, 'score': 0, 'reason': 'aguardando dados', 'strategies': []}

        close  = closes[-1]
        regime = self._detect_regime(pair)
        if regime == 'choppy':
            return {'side': None, 'score': 0, 'reason': 'mercado choppy', 'strategies': []}

        # Filtro macro (EMA 50)
        ema50      = self._ema(list(closes)[-50:], 50) if len(closes) >= 50 else None
        macro_bull = ema50 and close > ema50 * 1.001
        macro_bear = ema50 and close < ema50 * 0.999

        signals = []  # (side, strategy_name, reason, base_weight)

        # 1. EMA Micro
        ema3  = self._ema(list(closes)[-3:],  3)
        ema8  = self._ema(list(closes)[-8:],  8)
        ema21 = self._ema(list(closes)[-21:], 21)
        if ema3 > ema8 * 1.0001 and ema8 > ema21 * 0.9998:
            signals.append(('BUY',  'ema_micro', 'EMA micro bull', 1.0))
        elif ema3 < ema8 * 0.9999 and ema8 < ema21 * 1.0002:
            signals.append(('SELL', 'ema_micro', 'EMA micro bear', 1.0))

        # 2. RSI
        rsi_val = self._rsi(closes)
        if   rsi_val < 28: signals.append(('BUY',  'rsi_reversion', f'RSI extremo {rsi_val:.0f}', 1.8))
        elif rsi_val < 38: signals.append(('BUY',  'rsi_reversion', f'RSI baixo {rsi_val:.0f}',   0.9))
        elif rsi_val > 72: signals.append(('SELL', 'rsi_reversion', f'RSI extremo {rsi_val:.0f}', 1.8))
        elif rsi_val > 62: signals.append(('SELL', 'rsi_reversion', f'RSI alto {rsi_val:.0f}',    0.9))

        # 3. Bollinger
        bb = self._bollinger(closes)
        if bb:
            upper, mid, lower, pct_b, bw = bb
            if bw > 0.12:
                if   pct_b < 0.06: signals.append(('BUY',  'bollinger', f'BB lower {pct_b:.2f}', 1.4))
                elif pct_b < 0.18: signals.append(('BUY',  'bollinger', 'BB near lower',         0.8))
                elif pct_b > 0.94: signals.append(('SELL', 'bollinger', f'BB upper {pct_b:.2f}', 1.4))
                elif pct_b > 0.82: signals.append(('SELL', 'bollinger', 'BB near upper',         0.8))

        # 4. VWAP
        vwap = self._vwap(closes, volumes)
        dev  = (close - vwap) / vwap * 100 if vwap else 0
        if   dev < -0.35: signals.append(('BUY',  'vwap_dev', f'VWAP dev {dev:.2f}%',   1.3))
        elif dev < -0.18: signals.append(('BUY',  'vwap_dev', f'VWAP leve {dev:.2f}%',  0.7))
        elif dev >  0.35: signals.append(('SELL', 'vwap_dev', f'VWAP dev +{dev:.2f}%',  1.3))
        elif dev >  0.18: signals.append(('SELL', 'vwap_dev', f'VWAP leve +{dev:.2f}%', 0.7))

        # 5. Volume Momentum
        vols = list(volumes)
        if len(vols) >= 6:
            avg_vol  = sum(vols[-6:-1]) / 5
            last_vol = vols[-1]
            if avg_vol > 0 and last_vol > avg_vol * 1.5:
                cls = list(closes)
                if   cls[-1] > cls[-2] * 1.0008: signals.append(('BUY',  'volume_mom', f'Vol spike {last_vol/avg_vol:.1f}x up', 1.5))
                elif cls[-1] < cls[-2] * 0.9992: signals.append(('SELL', 'volume_mom', f'Vol spike {last_vol/avg_vol:.1f}x dn', 1.5))

        # 6. Stochastic
        if len(closes) >= 12:
            stk, std = self._stochastic(closes, highs, lows)
            if   stk < 22 and std < 28: signals.append(('BUY',  'stochastic', f'Stoch OS K={stk:.0f}', 1.2))
            elif stk > 78 and std > 72: signals.append(('SELL', 'stochastic', f'Stoch OB K={stk:.0f}', 1.2))

        # 7. CCI
        if len(closes) >= 14:
            cci_val = self._cci(closes, highs, lows)
            if   cci_val < -90: signals.append(('BUY',  'cci', f'CCI {cci_val:.0f}', 1.1))
            elif cci_val >  90: signals.append(('SELL', 'cci', f'CCI {cci_val:.0f}', 1.1))

        # 8. MACD Fast
        if len(closes) >= 15:
            ml, sl, hist = self._macd_fast(closes)
            if   hist > 0 and hist > abs(ml) * 0.12: signals.append(('BUY',  'macd_fast', f'MACD up {hist:.4f}', 1.0))
            elif hist < 0 and abs(hist) > abs(ml) * 0.12: signals.append(('SELL', 'macd_fast', f'MACD dn {hist:.4f}', 1.0))

        # 9. Price Action
        if len(opens) >= 2:
            pa = self._price_action(opens, closes, highs, lows)
            if pa == 'BUY':  signals.append(('BUY',  'price_action', 'Pinbar/Engulf bull', 1.5))
            elif pa == 'SELL':signals.append(('SELL', 'price_action', 'Pinbar/Engulf bear', 1.5))

        # Aplicar pesos adaptativos com filtro de tendência macro
        buy_score = 0.0; sell_score = 0.0
        buy_count = 0;   sell_count = 0
        buy_strats = []; sell_strats = []
        buy_reasons = []; sell_reasons = []

        for side, strat, reason, base_w in signals:
            w = self.learner.get_weight(pair, strat)
            # Filtro macro
            tm = 1.0
            if side == 'BUY'  and macro_bear: tm = 0.6
            if side == 'SELL' and macro_bull:  tm = 0.6
            if side == 'BUY'  and macro_bull:  tm = 1.2
            if side == 'SELL' and macro_bear:  tm = 1.2
            # Bônus por regime
            if regime in ('trending_up', 'trending_down'):
                if strat in ('ema_micro', 'macd_fast', 'volume_mom'): tm *= 1.15
            else:
                if strat in ('rsi_reversion', 'bollinger', 'vwap_dev', 'stochastic'): tm *= 1.15
            w = w * tm

            if side == 'BUY':
                buy_score  += w; buy_count  += 1
                buy_strats.append(strat); buy_reasons.append(reason)
            else:
                sell_score += w; sell_count += 1
                sell_strats.append(strat); sell_reasons.append(reason)

        # Verificar divergência
        total_s = buy_score + sell_score
        if total_s > 0 and 0.35 < buy_score / total_s < 0.65:
            return {'side': None, 'score': 0, 'reason': f'divergencia [{regime}]', 'strategies': []}

        min_score = 3.2 if regime == 'ranging' else 2.8

        if buy_count >= HFT_MIN_SIGNALS and buy_score > sell_score * 1.4 and buy_score >= min_score:
            confidence = min(buy_score / 6.0, 1.0)
            return {'side': 'BUY', 'score': buy_score, 'count': buy_count,
                    'reason': ' + '.join(buy_reasons[:3]),
                    'strategies': list(set(buy_strats)),
                    'regime': regime, 'rsi': rsi_val, 'price': close,
                    'confidence': confidence}

        if sell_count >= HFT_MIN_SIGNALS and sell_score > buy_score * 1.4 and sell_score >= min_score:
            confidence = min(sell_score / 6.0, 1.0)
            return {'side': 'SELL', 'score': sell_score, 'count': sell_count,
                    'reason': ' + '.join(sell_reasons[:3]),
                    'strategies': list(set(sell_strats)),
                    'regime': regime, 'rsi': rsi_val, 'price': close,
                    'confidence': confidence}

        return {'side': None, 'score': 0, 'strategies': [],
                'reason': f'sem consenso B:{buy_count}({buy_score:.1f}) S:{sell_count}({sell_score:.1f}) [{regime}]'}

    # ── Gestão de Ordens ─────────────────────────────────────────────────────

    def _get_sym_info(self, pair):
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
        return float(round(qty_d, max(0, -exp)))

    def _calc_qty(self, pair, price, confidence=0.5):
        if price <= 0: return 0
        info      = self._get_sym_info(pair)
        risk_mult = min(0.8 + confidence * 0.8, 1.2)
        if self.consec_losses >= 2: risk_mult *= 0.75
        budget = self.capital * (HFT_RISK_PCT / 100) * risk_mult
        qty    = self._round_step(budget / price, info['step'])
        if qty < info['min_qty']:
            qty = self._round_step(info['min_notional'] / price * 1.05, info['step'])
        return qty if qty >= info['min_qty'] else 0

    def _open_position(self, pair, side, price, reason, strategies, confidence=0.5):
        qty = self._calc_qty(pair, price, confidence)
        if qty <= 0: return False

        atr_val = self._atr(self.highs[pair], self.lows[pair], self.closes[pair])
        if atr_val <= 0: atr_val = price * 0.002

        sl_dist = max(atr_val * 1.0, price * HFT_SL_PCT / 100)
        tp_dist = max(atr_val * 2.0, sl_dist * HFT_MIN_RR)
        if confidence > 0.7: tp_dist *= 1.2

        if side == 'BUY':
            tp = price + tp_dist; sl = price - sl_dist
        else:
            tp = price - tp_dist; sl = price + sl_dist

        tp_pct = abs(tp - price) / price * 100
        sl_pct = abs(sl - price) / price * 100
        rr     = tp_pct / sl_pct if sl_pct > 0 else 0

        if rr < HFT_MIN_RR:
            log.debug(f'  HFT {pair} rejeitado R:R {rr:.2f} < {HFT_MIN_RR}')
            return False

        from binance.enums import SIDE_BUY, SIDE_SELL, ORDER_TYPE_MARKET
        b_side = SIDE_BUY if side == 'BUY' else SIDE_SELL

        try:
            if HFT_TESTNET:
                log.info(f'  [TESTNET] HFT {pair} {side} {qty:.6f} @ ${price:,.4f} | TP ${tp:,.4f} | SL ${sl:,.4f} | R:R 1:{rr:.1f}')
                order_id = int(time.time())
            else:
                order    = self.client.create_order(symbol=pair, side=b_side,
                               type=ORDER_TYPE_MARKET, quantity=qty)
                order_id = order.get('orderId', 0)
                fills    = order.get('fills', [])
                if fills:
                    price = sum(float(f['price'])*float(f['qty']) for f in fills) / \
                            sum(float(f['qty']) for f in fills)

            key = f'{pair}_{int(time.time()*1000)}'
            self.positions[key] = {
                'pair': pair, 'side': side, 'entry': price, 'qty': qty,
                'sl': sl, 'tp': tp, 'opened_at': time.time(),
                'order_id': order_id, 'reason': reason, 'db_id': None,
                'strategies': strategies, 'confidence': confidence,
                'be_activated': False,
            }
            self.last_trade_ts[pair] = time.time()
            log.info(f'  ENTRADA HFT {side} {pair} @ ${price:,.4f} | TP +{tp_pct:.2f}% | SL -{sl_pct:.2f}% | R:R 1:{rr:.1f} | conf={confidence:.0%} | {reason}')
            self.positions[key]['db_id'] = _hft_save_open(pair, side, price, qty, sl, tp)
            self.notify(
                f'HFT {side} -- {pair}\n'
                f'Entrada: ${price:,.4f}  TP: ${tp:,.4f} (+{tp_pct:.2f}%)  SL: ${sl:,.4f} (-{sl_pct:.2f}%)\n'
                f'Qtd: {qty} | R:R 1:{rr:.1f} | confianca {confidence:.0%} | {reason}'
            )
            return True
        except Exception as e:
            log.error(f'  HFT {pair} {side} erro: {e}')
            return False

    def _close_position(self, key, price, reason):
        pos = self.positions.get(key)
        if not pos: return
        pair = pos['pair']; side = pos['side']; qty = pos['qty']

        from binance.enums import SIDE_BUY, SIDE_SELL, ORDER_TYPE_MARKET
        close_side = SIDE_SELL if side == 'BUY' else SIDE_BUY
        try:
            if not HFT_TESTNET:
                self.client.create_order(symbol=pair, side=close_side,
                                         type=ORDER_TYPE_MARKET, quantity=qty)
        except Exception as e:
            log.error(f'  HFT close {pair} erro: {e}')

        pnl      = (price - pos['entry']) * qty if side == 'BUY' else (pos['entry'] - price) * qty
        self.daily_pnl += pnl
        duration = time.time() - pos['opened_at']
        win      = pnl > 0

        if win:
            self.daily_wins   += 1; self.consec_losses = 0
            self.consec_wins  += 1; icon = 'WIN'
        else:
            self.daily_losses += 1; self.consec_losses += 1
            self.consec_wins   = 0; icon = 'LOSS'

        if pair in self.pair_stats:
            s = self.pair_stats[pair]
            if win: s['wins'] += 1
            else:   s['losses'] += 1
            s['pnl'] += pnl

        strats = pos.get('strategies', [])
        for s in strats:
            if s in self.strategy_stats:
                if win: self.strategy_stats[s]['wins'] += 1
                else:   self.strategy_stats[s]['losses'] += 1

        # APRENDIZADO: registra resultado
        if strats:
            self.learner.record(pair, strats, win)

        self.trades_today.append({
            'pair': pair, 'side': side, 'entry': pos['entry'], 'exit': price,
            'qty': qty, 'pnl': pnl, 'duration': duration,
            'reason': reason, 'strategies': strats, 'ts': time.time()
        })

        _hft_save_close(pos.get('db_id'), price, pnl, reason)
        del self.positions[key]

        total = self.daily_wins + self.daily_losses
        wr    = self.daily_wins / total * 100 if total else 0
        log.info(f'  [{icon}] HFT FECHA {pair} | ${pnl:+.4f} | {int(duration)}s | {reason} | Hoje: {total}T WR:{wr:.0f}% PnL:${self.daily_pnl:+.4f}')
        self.notify(
            f'[{icon}] HFT fechou {pair} | P&L: ${pnl:+.4f} ({int(duration)}s)\n'
            f'Hoje: {total} trades | WR:{wr:.0f}% | PnL total: ${self.daily_pnl:+.4f}'
        )

        if self.consec_losses >= 3:
            pause = HFT_COOLDOWN * (self.consec_losses + 1)
            self.paused_until = time.time() + pause
            log.warning(f'  HFT: {self.consec_losses} losses -> pausa {pause}s')
            self.notify(f'HFT pausado {pause}s ({self.consec_losses} losses seguidos)')

    def _check_exit(self, pair, price):
        for key, pos in list(self.positions.items()):
            if pos['pair'] != pair: continue
            side  = pos['side']
            age   = time.time() - pos['opened_at']
            entry = pos['entry']
            tp    = pos['tp']
            sl    = pos['sl']

            # Trail stop: BE após 50% do caminho ao TP
            if not pos.get('be_activated', False):
                if side == 'BUY':
                    half_price = entry + (tp - entry) * 0.5
                    if price >= half_price:
                        new_sl = entry * 1.0003
                        if new_sl > sl:
                            self.positions[key]['sl'] = new_sl
                            self.positions[key]['be_activated'] = True
                            log.info(f'  Trail BE ativado {pair} -> SL ${new_sl:,.4f}')
                else:
                    half_price = entry - (entry - tp) * 0.5
                    if price <= half_price:
                        new_sl = entry * 0.9997
                        if new_sl < sl:
                            self.positions[key]['sl'] = new_sl
                            self.positions[key]['be_activated'] = True
                            log.info(f'  Trail BE ativado {pair} -> SL ${new_sl:,.4f}')

            # Verificar saída (lê sl atualizado)
            cur_sl = self.positions.get(key, {}).get('sl', sl)
            be     = pos.get('be_activated', False)
            sl_lbl = 'BE-SL' if be else 'SL'

            if side == 'BUY':
                if price >= tp:              self._close_position(key, price, f'TP +{(price/entry-1)*100:.2f}%')
                elif price <= cur_sl:        self._close_position(key, price, f'{sl_lbl} -{(1-price/entry)*100:.2f}%')
                elif age > HFT_TIME_EXIT and price > entry: self._close_position(key, price, 'Time-exit profit')
                elif age > HFT_TIME_EXIT * 2: self._close_position(key, price, 'Time-exit max')
            else:
                if price <= tp:             self._close_position(key, price, f'TP +{(entry/price-1)*100:.2f}%')
                elif price >= cur_sl:       self._close_position(key, price, f'{sl_lbl} -{(price/entry-1)*100:.2f}%')
                elif age > HFT_TIME_EXIT and price < entry: self._close_position(key, price, 'Time-exit profit')
                elif age > HFT_TIME_EXIT * 2: self._close_position(key, price, 'Time-exit max')

    def _poll_close_flags(self, pair, close):
        import os as _os, glob as _glob
        pair_flag = f'/tmp/hft_close_pair_{pair}'
        if _os.path.exists(pair_flag):
            try: _os.remove(pair_flag)
            except: pass
            self.close_position_by_pair(pair, 'Manual close via painel')
            return
        for fpath in _glob.glob('/tmp/hft_close_*'):
            if '_pair_' in fpath: continue
            try:
                data  = _json.loads(open(fpath).read())
                if data.get('pair') == pair or not data.get('pair'):
                    db_id = data.get('trade_id', '')
                    _os.remove(fpath)
                    if db_id:
                        if not self.close_position_by_id(db_id, 'Manual close via painel'):
                            self.close_position_by_pair(pair, 'Manual close via painel')
                    else:
                        self.close_position_by_pair(pair, 'Manual close via painel')
            except: pass

    def close_position_by_pair(self, pair, reason='Manual close via painel'):
        for key, pos in list(self.positions.items()):
            if pos['pair'] == pair:
                cur_price = list(self.closes.get(pair, [pos['entry']]))[-1]
                self._close_position(key, cur_price, reason)
                return True
        return False

    def close_position_by_id(self, db_id, reason='Manual close via painel'):
        for key, pos in list(self.positions.items()):
            if pos.get('db_id') == db_id or key == db_id:
                cur_price = list(self.closes.get(pos['pair'], [pos['entry']]))[-1]
                self._close_position(key, cur_price, reason)
                return True
        return False

    def on_candle(self, pair, open_, high, low, close, volume, is_closed):
        if pair not in self.closes:
            self.closes[pair]  = deque(maxlen=250)
            self.highs[pair]   = deque(maxlen=250)
            self.lows[pair]    = deque(maxlen=250)
            self.volumes[pair] = deque(maxlen=250)
            self.opens[pair]   = deque(maxlen=250)

        self._check_exit(pair, close)
        self._poll_close_flags(pair, close)

        if not is_closed: return

        self.closes[pair].append(close)
        self.highs[pair].append(high)
        self.lows[pair].append(low)
        self.volumes[pair].append(volume)
        self.opens[pair].append(open_)

        now = time.time()
        if not self.running: return
        if self.paused_until > now: return

        daily_loss_pct = abs(self.daily_pnl) / self.capital * 100 if self.daily_pnl < 0 else 0
        if daily_loss_pct >= HFT_DAILY_LOSS:
            if self.running:
                self.running = False
                self.notify(f'HFT Daily Loss {HFT_DAILY_LOSS}% atingido | PnL: ${self.daily_pnl:.4f}\nBot pausado ate amanha.')
            return

        if not self._in_active_session(): return

        cooldown = HFT_COOLDOWN
        if self.consec_wins >= 3: cooldown = int(HFT_COOLDOWN * 0.7)
        if now - self.last_trade_ts.get(pair, 0) < cooldown: return
        if sum(1 for k in self.positions if k.startswith(pair)) >= 1: return
        if len(self.positions) >= HFT_MAX_TRADES: return

        with self._lock:
            sig = self._generate_signal(pair)

        if sig['side']:
            log.info(
                f'  SINAL HFT {sig["side"]} {pair} score={sig["score"]:.1f} '
                f'({sig.get("count", 0)} sinais) conf={sig.get("confidence", 0):.0%} | '
                f'{sig["reason"]} [{sig.get("regime", "?")}]'
            )
            self._open_position(pair, sig['side'], close, sig['reason'],
                                sig.get('strategies', []), sig.get('confidence', 0.5))
        else:
            n_closes = len(self.closes.get(pair, []))
            if n_closes > 0 and n_closes % 20 == 0:
                rsi_val = self._rsi(self.closes[pair]) if n_closes >= 9 else 50
                regime  = self._detect_regime(pair) if n_closes >= 50 else '?'
                log.info(f'  HFT {pair} | velas={n_closes} RSI={rsi_val:.0f} regime={regime} | {sig["reason"]} | pos={len(self.positions)}')

    def get_stats(self):
        total = self.daily_wins + self.daily_losses
        return {
            'daily_pnl':      round(self.daily_pnl, 4),
            'daily_wins':     self.daily_wins,
            'daily_losses':   self.daily_losses,
            'win_rate':       round(self.daily_wins / total * 100, 1) if total else 0,
            'total_trades':   total,
            'open_positions': len(self.positions),
            'pairs':          list(set(p['pair'] for p in self.positions.values())),
            'pair_stats':     self.pair_stats,
            'consec_losses':  self.consec_losses,
            'consec_wins':    self.consec_wins,
            'learning':       self.learner.get_summary(),
        }

    def send_daily_summary(self):
        total    = self.daily_wins + self.daily_losses
        wr       = self.daily_wins / total * 100 if total > 0 else 0
        pnl_icon = 'POSITIVO' if self.daily_pnl >= 0 else 'NEGATIVO'
        top_pairs = sorted(self.pair_stats.items(), key=lambda x: x[1]['pnl'], reverse=True)
        pair_lines = '\n'.join(
            f"  {'OK' if s['pnl'] >= 0 else 'NG'} {p.replace('USDT',''):6} {s['wins']}W/{s['losses']}L  {'+'if s['pnl']>=0 else ''}${s['pnl']:.4f}"
            for p, s in top_pairs[:6] if s['wins'] + s['losses'] > 0
        ) or '  Nenhum trade hoje'
        learn_sum = self.learner.get_summary()
        top_strats = sorted(
            [(s, d) for s, d in learn_sum.items() if d['n'] >= 5],
            key=lambda x: float(x[1]['wr']) if x[1]['wr'] != 'N/A' else 0, reverse=True
        )
        strat_line = ', '.join(f"{s} {d['wr']}%" for s, d in top_strats[:4]) if top_strats else 'Aprendendo...'
        self.notify(
            f'Resumo Diario HFT v3.0\n'
            f'PnL: {"+"if self.daily_pnl>=0 else ""}${self.daily_pnl:.4f} [{pnl_icon}]\n'
            f'Trades: {total} ({self.daily_wins}W/{self.daily_losses}L)\n'
            f'Win Rate: {wr:.1f}%\n'
            f'Por par:\n{pair_lines}\n'
            f'Top estrategias (WR):\n  {strat_line}\n'
            f'{datetime.datetime.now().strftime("%d/%m/%Y %H:%M")}'
        )

    def reset_daily(self):
        log.info(f'  HFT reset diario | Fechando {len(self.positions)} posicoes')
        if self.daily_wins + self.daily_losses > 0:
            try: self.send_daily_summary()
            except: pass
        self.daily_pnl    = 0.0; self.daily_wins = 0;  self.daily_losses = 0
        self.trades_today = []; self.consec_losses = 0; self.consec_wins  = 0
        self.paused_until = 0
        self.pair_stats   = {p: {'wins': 0, 'losses': 0, 'pnl': 0.0} for p in HFT_PAIRS}
        self.strategy_stats = {s: {'wins': 0, 'losses': 0} for s in STRATEGY_NAMES}
        self.running      = True
        log.info('  HFT v3.0 novo dia iniciado')


# Singleton
_hft_engine = None

def get_hft_engine(): return _hft_engine
def init_hft(capital, client, notify_fn=None):
    global _hft_engine
    _hft_engine = HFTEngine(capital, client, notify_fn)
    _hft_engine.running = True
    return _hft_engine
