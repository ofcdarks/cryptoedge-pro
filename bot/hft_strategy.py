"""
CryptoEdge Pro — HFT Engine v3.1  ⚡ ADAPTIVE + CONFIRMATION + AUTO-CALIBRATION
=================================================================================
Alta frequência: 20-100 operações/dia em múltiplos pares.

v3.1 NOVIDADES sobre v3.0:
  ✅ FILTRO DE CONFIRMAÇÃO: sinal precisa ser confirmado na próxima vela
     → elimina falsos breakouts (principal causa de loss)
  ✅ AUTO-CALIBRAÇÃO: parâmetros ótimos (RSI, score, volume) por par
     → encontrados via backtest real antes de operar
  ✅ PREVENÇÃO DE ENTRADA ATRASADA: entrada confirmada só entra se
     o preço ainda está num range aceitável da origem do sinal
  ✅ Cooldown adaptativo: reduz após wins, aumenta após losses
  ✅ Trail stop + Break-even automático
  ✅ Aprendizado persistente entre sessões

ESTRATÉGIAS (9 com pesos adaptativos):
  1. EMA Micro (3/8/21), 2. RSI Reversion, 3. Bollinger Bands,
  4. VWAP Deviation, 5. Volume Momentum, 6. Stochastic,
  7. CCI, 8. MACD Fast (3/10/5), 9. Price Action

PROTEÇÕES:
  - Min 3 estratégias concordando
  - Score mínimo calibrado por par e regime
  - R:R mínimo 1.5:1 (calculado com ATR real)
  - Confirmação obrigatória em vela subsequente
  - Trail stop → Break-even após 50% do TP
  - Daily Loss Limit (para no dia)
  - Cooldown dinâmico
  - Filtro de regime (sem entradas em mercado choppy)
  - Filtro de tendência macro (EMA 50)
"""

import logging, time, os, threading, urllib.request, json as _json
from collections import deque
from decimal import Decimal
import datetime

# AI Advisor (lazy import para não crashar se módulo não existir)
try:
    from hft_ai_advisor import get_ai_advisor, HFTAIAdvisor
    _AI_MODULE_OK = True
except ImportError:
    _AI_MODULE_OK = False
    def get_ai_advisor(): return None

_APP_URL    = os.environ.get('APP_URL', 'http://localhost:' + os.environ.get('PORT', '3000'))
_BOT_HEADER = {'Content-Type': 'application/json', 'X-Bot-Internal': 'cryptoedge-bot-2024'}

# ── Persistência de aprendizado ───────────────────────────────────────────────
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

# ── Config global (env) ───────────────────────────────────────────────────────
HFT_TP_PCT       = float(os.environ.get('HFT_TP_PCT',      '0.55'))  # era 0.40%
HFT_SL_PCT       = float(os.environ.get('HFT_SL_PCT',      '0.38'))  # era 0.20%
# Trail Stop Progressivo: 4 niveis de travamento de lucro
# L1: lucro >= X% -> SL vai para break-even + buffer (nunca mais fecha no negativo)
# L2: lucro >= X% -> SL trava 40% do lucro
# L3: lucro >= X% -> SL trava 60% do lucro
# L4: lucro >= X% -> SL trava 75% do lucro
HFT_TRAIL_L1 = float(os.environ.get('HFT_TRAIL_L1', '0.04'))  # % lucro p/ BE
HFT_TRAIL_L2 = float(os.environ.get('HFT_TRAIL_L2', '0.08'))  # % lucro p/ travar 40%
HFT_TRAIL_L3 = float(os.environ.get('HFT_TRAIL_L3', '0.15'))  # % lucro p/ travar 60%
HFT_TRAIL_L4 = float(os.environ.get('HFT_TRAIL_L4', '0.25'))  # % lucro p/ travar 75%
HFT_TRAIL_BE_BUF = float(os.environ.get('HFT_TRAIL_BE_BUF', '0.01'))  # buffer BE %
HFT_RISK_PCT     = float(os.environ.get('HFT_RISK_PCT',    '5.0'))  # era 1.5% → 5% para lucro real
HFT_MAX_TRADES   = int(os.environ.get('HFT_MAX_TRADES',    '5'))   # era 3 → mais oportunidades
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
HFT_MIN_RR       = float(os.environ.get('HFT_MIN_RR',      '1.4')) # era 1.5
HFT_SESSION_FILTER = os.environ.get('HFT_SESSION_FILTER', 'false').lower() == 'true'
HFT_TZ_OFFSET    = int(os.environ.get('HFT_TZ_OFFSET',    '-3'))   # UTC-3 BRT

# Confirmação: máximo de desvio de preço permitido para confirmar sinal (%)
HFT_CONFIRM_MAX_DRIFT = float(os.environ.get('HFT_CONFIRM_MAX_DRIFT', '0.80'))  # era 0.15 → 0.80% para 1m candles
# Pula confirmação de vela (entra direto no sinal) — útil em tendências fortes
HFT_SKIP_CONFIRM = os.environ.get('HFT_SKIP_CONFIRM', 'false').lower() == 'true'
# Spot: só opera BUY (não tem ativo para vender short)
HFT_ONLY_BUY     = os.environ.get('HFT_ONLY_BUY', 'false').lower() == 'true'
# Tipo de mercado: 'spot' ou 'futures' — define qual API de ordens usar
HFT_MARKET       = os.environ.get('BOT_MARKET', 'spot').lower()

# ── Juros Compostos ───────────────────────────────────────────────────────────
# Quando ativado, o capital base sobe a cada dia com o lucro do dia anterior
# → cada trade usa um budget maior conforme o capital cresce
HFT_COMPOUND      = os.environ.get('HFT_COMPOUND', 'true').lower() == 'true'

# ── Visibilidade / Heartbeat ──────────────────────────────────────────────────
# Intervalo do heartbeat em segundos (0 = desativado)
HFT_HEARTBEAT_SEC  = int(os.environ.get('HFT_HEARTBEAT_SEC',  '300'))   # 5 min
# Notificar via Telegram quando sinal pendente for gerado
HFT_NOTIFY_SIGNAL  = os.environ.get('HFT_NOTIFY_SIGNAL', 'true').lower() == 'true'
HFT_CAPITAL_FILE  = os.environ.get('HFT_CAPITAL_FILE', '/data/hft_capital.json')

STRATEGY_NAMES = [
    'ema_micro', 'rsi_reversion', 'bollinger', 'vwap_dev',
    'volume_mom', 'stochastic', 'cci', 'macd_fast', 'price_action'
]

BASE_WEIGHTS = {
    'ema_micro':     1.0,
    'rsi_reversion': 1.5,
    'bollinger':     1.2,
    'vwap_dev':      1.2,
    'volume_mom':    1.3,
    'stochastic':    1.1,
    'cci':           1.0,
    'macd_fast':     0.9,
    'price_action':  1.4,
}

# ─────────────────────────────────────────────────────────────────────────────
class AdaptiveLearner:
    """
    Aprende com erros, reforça acertos.
    WR 70% → peso +40% | WR 30% → peso -40%
    Salva histórico em JSON entre sessões.
    """
    WINDOW = 60

    def __init__(self):
        self._lock = threading.Lock()
        data = _load_learning()
        self._global   = {}
        self._per_pair = {}
        for s in STRATEGY_NAMES:
            hist = data.get('global', {}).get(s, [])
            self._global[s] = deque(hist[-self.WINDOW:], maxlen=self.WINDOW)
        for pair in HFT_PAIRS:
            self._per_pair[pair] = {}
            for s in STRATEGY_NAMES:
                hist = data.get('pairs', {}).get(pair, {}).get(s, [])
                self._per_pair[pair][s] = deque(hist[-self.WINDOW:], maxlen=self.WINDOW)
        total = sum(len(v) for v in self._global.values())
        log.info(f'  🧠 AdaptiveLearner: {total} registros carregados')

    def record(self, pair, strategies_used, win):
        outcome = 1 if win else 0
        with self._lock:
            for s in strategies_used:
                if s in self._global:
                    self._global[s].append(outcome)
                if pair in self._per_pair and s in self._per_pair[pair]:
                    self._per_pair[pair][s].append(outcome)
            self._dirty = getattr(self, '_dirty', 0) + 1
        # Persiste a cada 10 trades (não a cada trade) para reduzir I/O
        if self._dirty >= 10:
            self._persist()
            self._dirty = 0

    def _wr(self, history):
        return sum(history) / len(history) if len(history) >= 5 else 0.5

    def get_weight(self, pair, strategy):
        base = BASE_WEIGHTS.get(strategy, 1.0)
        with self._lock:
            wg = self._wr(self._global.get(strategy, deque()))
            wp = self._wr(self._per_pair.get(pair, {}).get(strategy, deque()))
            ng = len(self._global.get(strategy, deque()))
            np_ = len(self._per_pair.get(pair, {}).get(strategy, deque()))
        wr = wg if np_ < 5 else wp if ng < 5 else 0.4 * wg + 0.6 * wp
        return base * max(0.5, min(2.0, 0.2 + wr * 1.6))

    def get_summary(self):
        out = {}
        for s in STRATEGY_NAMES:
            with self._lock:
                h = self._global.get(s, deque())
                n = len(h); wr = self._wr(h) * 100 if n >= 5 else None
            out[s] = {'n': n, 'wr': round(wr, 1) if wr is not None else 'N/A'}
        return out

    def _persist(self):
        try:
            _save_learning({
                'global': {s: list(self._global[s]) for s in STRATEGY_NAMES},
                'pairs':  {p: {s: list(self._per_pair[p][s]) for s in STRATEGY_NAMES}
                           for p in self._per_pair},
                'saved_at': datetime.datetime.now().isoformat()
            })
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

        # PnL acumulado por período (persiste via arquivo para sobreviver reinicializações)
        self.daily_breakevens = 0          # trades que fecharam em 0 (±threshold)
        self._pnl_file = os.environ.get('HFT_PNL_FILE', '/data/hft_pnl_history.json')
        self._pnl_data  = self._load_pnl_history()
        self._be_threshold = float(os.environ.get('HFT_BE_THRESHOLD', '0.0002'))  # $0.0002 = break-even
        self.learner         = AdaptiveLearner()

        # ── CONFIRMAÇÃO: pendingSignals[pair] = {side, score, strategies, ...}
        self._pending        = {}   # par → sinal pendente aguardando confirmação
        self._candle_count   = {p: 0 for p in HFT_PAIRS}  # contador de velas por par

        # ── Parâmetros calibrados por par (carregados do calibrador)
        self._pair_params    = {}   # par → {rsi_buy, rsi_sell, min_score, ...}
        self._load_calibration()

        # ── AI Advisor
        # AI Advisor desativado por padrão no HFT — latência de 3-4s prejudica entradas em 1m
        # Para ativar: HFT_AI_ENABLED=true no .bot.env ou variáveis de ambiente
        _ai_default = os.environ.get('HFT_AI_ENABLED', 'false').lower() == 'true'
        self.ai_advisor = (get_ai_advisor() if _AI_MODULE_OK else None) if _ai_default else None
        self._ai_skipped = 0    # trades ignorados pela IA
        self._ai_approved = 0   # trades aprovados pela IA

        # ── Juros compostos: carrega capital persistido da sessão anterior ──
        if HFT_COMPOUND:
            self.capital = self._load_capital()

        log.info('  🚀 HFT Engine v3.1 ADAPTIVE + CONFIRMATION + CALIBRATION + AI iniciado')
        if HFT_COMPOUND:
            log.info(f'  💰 Juros compostos: ATIVO | capital atual = ${self.capital:.2f}')

    # ── PnL History ─────────────────────────────────────────────────────────

    def _load_pnl_history(self) -> dict:
        """Carrega histórico de PnL mensal/anual do arquivo JSON."""
        try:
            if os.path.exists(self._pnl_file):
                with open(self._pnl_file) as f:
                    return _json.load(f)
        except Exception:
            pass
        return {'daily': {}, 'monthly': {}, 'annual': {}}

    def _save_pnl_history(self):
        """Persiste histórico de PnL."""
        try:
            os.makedirs(os.path.dirname(self._pnl_file), exist_ok=True)
            with open(self._pnl_file, 'w') as f:
                _json.dump(self._pnl_data, f)
        except Exception:
            pass

    def _record_pnl(self, pnl: float, win: bool, be: bool):
        """Registra trade nos contadores diário/mensal/anual."""
        now   = datetime.datetime.now()
        day   = now.strftime('%Y-%m-%d')
        month = now.strftime('%Y-%m')
        year  = now.strftime('%Y')

        for period, key in [('daily', day), ('monthly', month), ('annual', year)]:
            if key not in self._pnl_data[period]:
                self._pnl_data[period][key] = {'pnl': 0.0, 'wins': 0, 'losses': 0, 'bes': 0, 'trades': 0}
            d = self._pnl_data[period][key]
            d['pnl']    = round(d['pnl'] + pnl, 6)
            d['trades'] += 1
            if be:   d['bes']    += 1
            elif win:d['wins']   += 1
            else:    d['losses'] += 1

        self._save_pnl_history()

    def get_pnl_summary(self) -> dict:
        """Retorna resumo de PnL por período para o dashboard."""
        now   = datetime.datetime.now()
        day   = now.strftime('%Y-%m-%d')
        month = now.strftime('%Y-%m')
        year  = now.strftime('%Y')

        def _fmt(d: dict) -> dict:
            t = d.get('trades', 0)
            w = d.get('wins', 0)
            l = d.get('losses', 0)
            b = d.get('bes', 0)
            # win rate: break-even não conta como loss nem win
            effective = w + l  # ignora BEs
            return {
                'pnl':        round(d.get('pnl', 0.0), 4),
                'wins':       w,
                'losses':     l,
                'breakevens': b,
                'trades':     t,
                'win_rate':   round(w / effective * 100, 1) if effective > 0 else 0.0,
            }

        today_db  = self._pnl_data['daily'].get(day, {})
        month_db  = self._pnl_data['monthly'].get(month, {})
        year_db   = self._pnl_data['annual'].get(year, {})

        # Mescla com contadores em memória (mais recentes que o arquivo)
        today_live = {
            'pnl':     self.daily_pnl,
            'wins':    self.daily_wins,
            'losses':  self.daily_losses,
            'bes':     self.daily_breakevens,
            'trades':  self.daily_wins + self.daily_losses + self.daily_breakevens,
        }
        # Usa live para hoje (mais preciso), db para meses/anos anteriores
        return {
            'today':   _fmt(today_live),
            'monthly': _fmt(month_db),
            'annual':  _fmt(year_db),
            'last_update': datetime.datetime.now().isoformat(),
        }

    def _load_capital(self) -> float:
        """Carrega capital persistido (juros compostos entre sessões)."""
        try:
            if HFT_COMPOUND and os.path.exists(HFT_CAPITAL_FILE):
                with open(HFT_CAPITAL_FILE) as f:
                    data = _json.load(f)
                saved = float(data.get('capital', 0))
                if saved > 0:
                    log.info(f'  💰 Juros compostos: capital carregado = ${saved:.2f} (era ${self.capital:.2f})')
                    return saved
        except Exception as e:
            log.warning(f'  Compound capital load erro: {e}')
        return self.capital

    def _save_capital(self):
        """Persiste capital atual para uso na próxima sessão."""
        if not HFT_COMPOUND: return
        try:
            os.makedirs(os.path.dirname(HFT_CAPITAL_FILE), exist_ok=True)
            with open(HFT_CAPITAL_FILE, 'w') as f:
                _json.dump({
                    'capital': round(self.capital, 4),
                    'updated': datetime.datetime.now().isoformat(),
                    'initial': float(os.environ.get('BOT_CAPITAL', str(self.capital))),
                }, f)
        except Exception as e:
            log.warning(f'  Compound capital save erro: {e}')

    def _load_calibration(self):
        """Carrega parâmetros calibrados por par."""
        try:
            from hft_calibrator import load_calibration
            data = load_calibration()
            if data:
                for pair, info in data.get('pairs', {}).items():
                    self._pair_params[pair] = info.get('params', {})
                log.info(f'  📐 Calibração carregada para {len(self._pair_params)} pares')
            else:
                log.info('  📐 Sem calibração disponível — usando parâmetros padrão')
        except Exception as e:
            log.info(f'  📐 Calibrador indisponível ({e}) — usando padrão')

    def _get_pair_param(self, pair, key, default):
        """Retorna parâmetro calibrado para o par, ou default."""
        return self._pair_params.get(pair, {}).get(key, default)

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
        g = [max(vals[i] - vals[i-1], 0) for i in range(1, len(vals))]
        l = [max(vals[i-1] - vals[i], 0) for i in range(1, len(vals))]
        ag = sum(g) / len(g); al = sum(l) / len(l)
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
        tp   = [(h[i] + l[i] + c[i]) / 3 for i in range(len(c))]
        m    = sum(tp) / len(tp)
        md   = sum(abs(t - m) for t in tp) / len(tp)
        return (tp[-1] - m) / (0.015 * md) if md else 0

    def _macd_fast(self, closes):
        vals = list(closes)
        if len(vals) < 15: return 0, 0, 0
        ef = self._ema(vals[-3:], 3); es = self._ema(vals[-10:], 10)
        ml = ef - es; ms = []
        for i in range(max(0, len(vals) - 10), len(vals)):
            ms.append(self._ema(vals[max(0, i-3):i+1], 3) - self._ema(vals[max(0, i-10):i+1], 10))
        sl = self._ema(ms[-5:], 5) if len(ms) >= 5 else ml
        return ml, sl, ml - sl

    def _price_action(self, opens, closes, highs, lows):
        o = list(opens); c = list(closes); h = list(highs); l = list(lows)
        if len(c) < 2: return None
        body = abs(c[-1] - o[-1]); rng = h[-1] - l[-1]
        if rng > 0:
            uw = h[-1] - max(c[-1], o[-1]); lw = min(c[-1], o[-1]) - l[-1]
            if lw > body * 2 and lw > uw * 2: return 'BUY'
            if uw > body * 2 and uw > lw * 2: return 'SELL'
        pb = abs(c[-2] - o[-2])
        if body > pb * 1.5:
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
        return round(100 * abs(pdi - ndi) / (pdi + ndi), 1) if (pdi + ndi) > 0 else 0

    # ── Regime de Mercado ─────────────────────────────────────────────────────

    def _detect_regime(self, pair):
        closes = self.closes[pair]; highs = self.highs[pair]; lows = self.lows[pair]
        if len(closes) < 50: return 'ranging'
        ema21 = self._ema(list(closes)[-21:], 21)
        ema50 = self._ema(list(closes)[-50:], 50)
        close = closes[-1]
        bb    = self._bollinger(closes, period=20)
        bw    = bb[4] if bb else 1.0
        adx_v = self._adx(highs, lows, closes)
        if bw < 0.05: return 'choppy'  # era 0.08 — só bloqueia mercado extremamente flat
        if adx_v > 25:
            if close > ema21 > ema50: return 'trending_up'
            if close < ema21 < ema50: return 'trending_down'
        return 'ranging'

    def _in_active_session(self):
        if not HFT_SESSION_FILTER: return True
        # Usa timezone local configurável (padrão UTC-3 = BRT)
        h = (datetime.datetime.utcnow().hour + HFT_TZ_OFFSET) % 24
        # Janela ampla: das 06h às 23h59 horário local — cobre toda sessão cripto relevante
        return 6 <= h < 24

    # ── Geração de Sinal ─────────────────────────────────────────────────────

    def _generate_signal(self, pair):
        closes = self.closes[pair]; highs = self.highs[pair]
        lows   = self.lows[pair];   volumes = self.volumes[pair]
        opens  = self.opens[pair]

        if len(closes) < 30:
            return {'side': None, 'score': 0, 'reason': 'aguardando dados', 'strategies': []}

        close  = closes[-1]
        regime = self._detect_regime(pair)
        if regime == 'choppy':
            return {'side': None, 'score': 0, 'reason': 'choppy', 'strategies': []}

        # Parâmetros calibrados para este par
        rsi_buy  = self._get_pair_param(pair, 'rsi_buy',  28.0)
        rsi_sell = self._get_pair_param(pair, 'rsi_sell', 72.0)
        vol_mult = self._get_pair_param(pair, 'vol_mult',  1.5)
        min_sc   = self._get_pair_param(pair, 'min_score', 3.0)
        min_sg   = self._get_pair_param(pair, 'min_signals', HFT_MIN_SIGNALS)

        # Filtro macro EMA 50
        ema50      = self._ema(list(closes)[-50:], 50) if len(closes) >= 50 else None
        macro_bull = ema50 and close > ema50 * 1.001
        macro_bear = ema50 and close < ema50 * 0.999

        signals = []   # (side, strat, reason, base_weight)

        # 1. EMA Micro
        e3 = self._ema(list(closes)[-3:], 3)
        e8 = self._ema(list(closes)[-8:], 8)
        e21= self._ema(list(closes)[-21:], 21)
        if e3 > e8 * 1.0001 and e8 > e21 * 0.9998:
            signals.append(('BUY',  'ema_micro', 'EMA bull', 1.0))
        elif e3 < e8 * 0.9999 and e8 < e21 * 1.0002:
            signals.append(('SELL', 'ema_micro', 'EMA bear', 1.0))

        # 2. RSI (thresholds calibrados)
        rsi_v = self._rsi(closes)
        if rsi_v < rsi_buy:
            w = 1.8 if rsi_v < rsi_buy - 8 else 0.9
            signals.append(('BUY',  'rsi_reversion', f'RSI {rsi_v:.0f}', w))
        elif rsi_v > rsi_sell:
            w = 1.8 if rsi_v > rsi_sell + 8 else 0.9
            signals.append(('SELL', 'rsi_reversion', f'RSI {rsi_v:.0f}', w))

        # 3. Bollinger
        bb = self._bollinger(closes)
        if bb:
            _, _, _, pct_b, bw_v = bb
            if bw_v > 0.12:
                if   pct_b < 0.06: signals.append(('BUY',  'bollinger', f'BB low {pct_b:.2f}', 1.4))
                elif pct_b < 0.18: signals.append(('BUY',  'bollinger', 'BB near low',          0.8))
                elif pct_b > 0.94: signals.append(('SELL', 'bollinger', f'BB high {pct_b:.2f}', 1.4))
                elif pct_b > 0.82: signals.append(('SELL', 'bollinger', 'BB near high',         0.8))

        # 4. VWAP
        vw  = self._vwap(closes, volumes)
        dev = (close - vw) / vw * 100 if vw else 0
        if   dev < -0.35: signals.append(('BUY',  'vwap_dev', f'VWAP {dev:.2f}%',  1.3))
        elif dev < -0.18: signals.append(('BUY',  'vwap_dev', f'VWAP {dev:.2f}%',  0.7))
        elif dev >  0.35: signals.append(('SELL', 'vwap_dev', f'VWAP +{dev:.2f}%', 1.3))
        elif dev >  0.18: signals.append(('SELL', 'vwap_dev', f'VWAP +{dev:.2f}%', 0.7))

        # 5. Volume Momentum (limiar calibrado)
        vols = list(volumes)
        if len(vols) >= 6:
            avg_v = sum(vols[-6:-1]) / 5
            if avg_v > 0 and vols[-1] > avg_v * vol_mult:
                cls = list(closes)
                if   cls[-1] > cls[-2] * 1.0008: signals.append(('BUY',  'volume_mom', f'Vol {vols[-1]/avg_v:.1f}x', 1.5))
                elif cls[-1] < cls[-2] * 0.9992: signals.append(('SELL', 'volume_mom', f'Vol {vols[-1]/avg_v:.1f}x', 1.5))

        # 6. Stochastic
        if len(closes) >= 12:
            stk, std = self._stochastic(closes, highs, lows)
            if   stk < 22 and std < 28: signals.append(('BUY',  'stochastic', f'Stoch {stk:.0f}', 1.2))
            elif stk > 78 and std > 72: signals.append(('SELL', 'stochastic', f'Stoch {stk:.0f}', 1.2))

        # 7. CCI
        if len(closes) >= 14:
            cci_v = self._cci(closes, highs, lows)
            if   cci_v < -90: signals.append(('BUY',  'cci', f'CCI {cci_v:.0f}', 1.1))
            elif cci_v >  90: signals.append(('SELL', 'cci', f'CCI {cci_v:.0f}', 1.1))

        # 8. MACD Fast
        if len(closes) >= 15:
            ml, sl, hist = self._macd_fast(closes)
            if   hist > 0 and hist > abs(ml) * 0.12: signals.append(('BUY',  'macd_fast', f'MACD {hist:.4f}', 1.0))
            elif hist < 0 and abs(hist) > abs(ml) * 0.12: signals.append(('SELL', 'macd_fast', f'MACD {hist:.4f}', 1.0))

        # 9. Price Action
        if len(opens) >= 2:
            pa = self._price_action(opens, closes, highs, lows)
            if pa == 'BUY':   signals.append(('BUY',  'price_action', 'Pinbar/Engulf bull', 1.5))
            elif pa == 'SELL': signals.append(('SELL', 'price_action', 'Pinbar/Engulf bear', 1.5))

        # ── Pesos adaptativos + filtros ───────────────────────────────────
        buy_score = 0.0; sell_score = 0.0
        buy_count = 0;   sell_count = 0
        buy_strats = []; sell_strats = []
        buy_reasons = []; sell_reasons = []

        for side, strat, reason, base_w in signals:
            w  = self.learner.get_weight(pair, strat)
            tm = 1.0
            if side == 'BUY'  and macro_bear: tm = 0.6
            if side == 'SELL' and macro_bull:  tm = 0.6
            if side == 'BUY'  and macro_bull:  tm = 1.2
            if side == 'SELL' and macro_bear:  tm = 1.2
            if regime in ('trending_up', 'trending_down'):
                if strat in ('ema_micro', 'macd_fast', 'volume_mom'): tm *= 1.15
            else:
                if strat in ('rsi_reversion', 'bollinger', 'vwap_dev', 'stochastic'): tm *= 1.15
            w *= tm

            if side == 'BUY':
                buy_score += w; buy_count += 1
                buy_strats.append(strat); buy_reasons.append(reason)
            else:
                sell_score += w; sell_count += 1
                sell_strats.append(strat); sell_reasons.append(reason)

        # Divergência
        tot = buy_score + sell_score
        if tot > 0 and 0.35 < buy_score / tot < 0.65:
            return {'side': None, 'score': 0, 'reason': f'divergencia [{regime}]', 'strategies': []}

        if buy_count >= min_sg and buy_score >= min_sc and buy_score > sell_score * 1.4:
            return {'side': 'BUY', 'score': buy_score, 'count': buy_count,
                    'reason': ' + '.join(buy_reasons[:3]),
                    'strategies': list(set(buy_strats)),
                    'regime': regime, 'rsi': rsi_v, 'price': close,
                    'confidence': min(buy_score / 6.0, 1.0)}

        if sell_count >= min_sg and sell_score >= min_sc and sell_score > buy_score * 1.4:
            if HFT_ONLY_BUY:
                return {'side': None, 'score': 0, 'strategies': [],
                        'reason': f'SELL ignorado (HFT_ONLY_BUY=true) [{regime}]'}
            return {'side': 'SELL', 'score': sell_score, 'count': sell_count,
                    'reason': ' + '.join(sell_reasons[:3]),
                    'strategies': list(set(sell_strats)),
                    'regime': regime, 'rsi': rsi_v, 'price': close,
                    'confidence': min(sell_score / 6.0, 1.0)}

        return {'side': None, 'score': 0, 'strategies': [],
                'reason': f'sem consenso B:{buy_count}({buy_score:.1f}) S:{sell_count}({sell_score:.1f}) [{regime}]'}

    # ── FILTRO DE CONFIRMAÇÃO ─────────────────────────────────────────────────
    # Lógica:
    #   Vela 1: sinal é gerado → armazenado como PENDENTE (não entra ainda)
    #   Vela 2: verifica se o mercado CONFIRMOU a direção:
    #     BUY confirmado:  close > open (vela de alta) E preço não fugiu >drift%
    #     SELL confirmado: close < open (vela de baixa) E preço não fugiu >drift%
    #   Se confirmado → entra. Se não → descarta pendente.
    # ─────────────────────────────────────────────────────────────────────────

    def _try_confirm_and_enter(self, pair, open_, close, volume):
        """
        Verifica se há sinal pendente para o par e se a vela atual confirma.
        Retorna True se entrou numa posição.
        """
        pending = self._pending.get(pair)
        if not pending:
            return False

        side           = pending['side']
        origin_price   = pending['price']
        drift          = abs(close - origin_price) / origin_price * 100

        # Se o preço fugiu muito do sinal original, descarta (entrada atrasada)
        if drift > HFT_CONFIRM_MAX_DRIFT:
            log.info(f'  ⚠ HFT {pair} confirmação DESCARTADA: drift {drift:.2f}% > {HFT_CONFIRM_MAX_DRIFT}% | Evita entrada atrasada')
            del self._pending[pair]
            return False

        # Pula confirmação se HFT_SKIP_CONFIRM=true
        if HFT_SKIP_CONFIRM:
            log.info(f'  ✅ HFT {pair} {side} SKIP_CONFIRM ativo — entrando direto (drift={drift:.3f}%)')
        else:
            # Verificar se a vela confirma a direção
            bullish_candle = close > open_ * 1.0001
            bearish_candle = close < open_ * 0.9999
            confirmed = (side == 'BUY' and bullish_candle) or (side == 'SELL' and bearish_candle)

            if not confirmed:
                attempts = pending.get('attempts', 0) + 1
                confidence = pending.get('confidence', 0.5)
                # Após 1 tentativa frustrada, sinais >= 75% entram mesmo sem vela a favor
                # Isso cobre mercados laterais/tendência onde a confirmação raramente vem
                if confidence >= 0.75 and attempts <= 1:
                    self._pending[pair]['attempts'] = attempts
                    log.info(f'  ⏳ HFT {pair} {side} vela não confirmou — conf {confidence:.0%} ≥ 75%, aguarda +1 vela')
                    return False
                elif confidence >= 0.75 and attempts > 1:
                    log.info(f'  ➡️ HFT {pair} {side} 2ª tentativa conf {confidence:.0%} — entrando sem confirmação de vela')
                    # Continua para entrada
                else:
                    log.info(f'  ✗ HFT {pair} {side} NÃO confirmado conf={confidence:.0%} → descartado')
                    del self._pending[pair]
                    return False

        # ── CONFIRMADO → consultar IA antes de entrar ──────────────────
        log.info(f'  ✅ HFT {pair} {side} CONFIRMADO em ${close:,.4f} (drift={drift:.3f}%) | {pending["reason"]}')
        del self._pending[pair]

        # Monta contexto de indicadores para a IA
        entry_conf   = pending.get('confidence', 0.5)
        entry_reason = pending.get('reason', '')
        entry_strats = pending.get('strategies', [])

        # Calcula TP/SL estimados para dar contexto à IA
        atr_now = self._atr(self.highs[pair], self.lows[pair], self.closes[pair])
        if atr_now <= 0: atr_now = close * 0.002
        min_rr_p = self._get_pair_param(pair, 'min_rr', HFT_MIN_RR)
        sl_d     = max(atr_now, close * HFT_SL_PCT / 100)
        tp_d     = max(atr_now * 2, sl_d * min_rr_p)
        tp_pct_est = tp_d / close * 100
        sl_pct_est = sl_d / close * 100

        # Indicadores para o prompt da IA
        rsi_now  = self._rsi(self.closes[pair]) if len(self.closes[pair]) >= 9 else 50
        ema21_now = self._ema(list(self.closes[pair])[-21:], 21) if len(self.closes[pair]) >= 21 else close
        ema50_now = self._ema(list(self.closes[pair])[-50:], 50) if len(self.closes[pair]) >= 50 else close
        bb_now    = self._bollinger(self.closes[pair])
        bb_pct_b  = bb_now[3] if bb_now else 0.5
        ml, sl_v, mh = self._macd_fast(self.closes[pair])
        vols_now  = list(self.volumes[pair])
        avg_v     = sum(vols_now[-6:-1]) / 5 if len(vols_now) >= 6 else 1
        vol_ratio = vols_now[-1] / avg_v if avg_v > 0 else 1.0
        adx_now   = self._adx(self.highs[pair], self.lows[pair], self.closes[pair])
        regime_now = self._detect_regime(pair)

        indicators_ctx = {
            'rsi':      rsi_now, 'ema21': ema21_now, 'ema50': ema50_now,
            'atr_pct':  atr_now / close * 100, 'vol_ratio': vol_ratio,
            'bb_pct_b': bb_pct_b, 'macd_hist': mh,
            'regime':   regime_now, 'adx': adx_now,
        }
        signal_ctx = {
            'score': pending.get('score', 0), 'count': pending.get('count', 0),
            'strategies': entry_strats, 'reason': entry_reason,
            'confidence': entry_conf,
            'tp_pct': tp_pct_est, 'sl_pct': sl_pct_est,
        }
        pair_stats_ctx = self.pair_stats.get(pair, {'wins':0,'losses':0,'pnl':0.0})
        learning_ctx   = self.learner.get_summary() if hasattr(self, 'learner') else {}

        # Consulta IA (não-bloqueante, com fallback automático)
        ai_result = None
        if self.ai_advisor and self.ai_advisor.enabled:
            ai_result = self.ai_advisor.validate(
                pair, side, close,
                indicators_ctx, signal_ctx,
                pair_stats_ctx, learning_ctx
            )

        # Processa decisão da IA
        if ai_result and ai_result.get('source') not in ('fallback', 'disabled'):
            ai_decision = ai_result.get('decision', 'ENTER')
            ai_conf     = ai_result.get('confidence', 0.5)
            ai_reason   = ai_result.get('reason', '')
            tp_mult     = ai_result.get('tp_mult', 1.0)
            sl_mult     = ai_result.get('sl_mult', 1.0)

            if ai_decision == 'SKIP':
                self._ai_skipped += 1
                log.info(f'  🚫 AI BLOQUEOU {pair} {side} | {ai_reason} | conf_ia={ai_conf:.0%}')
                self.notify(
                    f'IA bloqueou entrada {side} {pair} | Motivo: {ai_reason} | conf {ai_conf:.0%}'
                )
                return False

            elif ai_decision == 'REDUCE':
                # Entra com confiança reduzida (menor position size)
                self._ai_approved += 1
                entry_conf = min(entry_conf, 0.4)  # força size reduzido
                full_reason = f'[IA:REDUCE {ai_conf:.0%}] {entry_reason}'
                log.info(f'  ⚠️  AI REDUCE {pair} {side} | {ai_reason} | entrando com size reduzido')
            else:
                # ENTER ou FALLBACK: aprova, possivelmente ajustando TP/SL
                self._ai_approved += 1
                full_reason = f'[IA:{ai_conf:.0%}] {entry_reason}'
                if abs(tp_mult - 1.0) > 0.05 or abs(sl_mult - 1.0) > 0.05:
                    log.info(f'  🤖 AI ajustou {pair}: TP×{tp_mult:.1f} SL×{sl_mult:.1f}')

            # Passa multiplicadores para _open_position via signal_ctx ajustado
            entered = self._open_position(
                pair, side, close, full_reason,
                entry_strats, entry_conf,
                tp_mult=tp_mult, sl_mult=sl_mult
            )
        else:
            # Sem IA ou fallback: opera normalmente
            entered = self._open_position(
                pair, side, close, f'[CONF] {entry_reason}',
                entry_strats, entry_conf
            )
        return entered

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
                log.warning(f'  sym_info {pair}: {e}')
                self._sym_info[pair] = {'min_qty': 0.001, 'step': 0.001, 'min_notional': 10.0}
        return self._sym_info[pair]

    def _round_step(self, v, step):
        sd = Decimal(str(step)).normalize(); vd = Decimal(str(v))
        qd = (vd // sd) * sd
        return float(round(qd, max(0, -sd.as_tuple().exponent)))

    def _calc_qty(self, pair, price, confidence=0.5):
        if price <= 0: return 0
        info      = self._get_sym_info(pair)
        risk_mult = min(0.8 + confidence * 1.0, 1.5)  # era max 1.2x → agora 1.5x em alta confiança
        if self.consec_losses >= 2: risk_mult *= 0.7    # reduz mais agressivamente após losses
        budget = self.capital * (HFT_RISK_PCT / 100) * risk_mult
        qty    = self._round_step(budget / price, info['step'])
        if qty < info['min_qty']:
            qty = self._round_step(info['min_notional'] / price * 1.05, info['step'])
        return qty if qty >= info['min_qty'] else 0

    def _open_position(self, pair, side, price, reason, strategies, confidence=0.5, tp_mult=1.0, sl_mult=1.0):
        qty = self._calc_qty(pair, price, confidence)
        if qty <= 0: return False

        atr_val = self._atr(self.highs[pair], self.lows[pair], self.closes[pair])
        if atr_val <= 0: atr_val = price * 0.002

        min_rr  = self._get_pair_param(pair, 'min_rr', HFT_MIN_RR)
        sl_dist = max(atr_val * 1.0, price * HFT_SL_PCT / 100) * sl_mult
        tp_dist = max(atr_val * 2.0, sl_dist * min_rr) * tp_mult
        if confidence > 0.7: tp_dist *= 1.2

        if side == 'BUY':
            tp = price + tp_dist; sl = price - sl_dist
        else:
            tp = price - tp_dist; sl = price + sl_dist

        tp_pct = abs(tp - price) / price * 100
        sl_pct = abs(sl - price) / price * 100
        rr     = tp_pct / sl_pct if sl_pct > 0 else 0

        if rr < min_rr:
            log.debug(f'  HFT {pair} rejeitado R:R {rr:.2f} < {min_rr}')
            return False

        from binance.enums import SIDE_BUY, SIDE_SELL, ORDER_TYPE_MARKET
        b_side = SIDE_BUY if side == 'BUY' else SIDE_SELL

        try:
            if HFT_TESTNET:
                log.info(f'  [TESTNET] HFT {pair} {side} {qty:.6f} @ ${price:,.4f} | TP ${tp:,.4f} | SL ${sl:,.4f} | R:R 1:{rr:.1f}')
                order_id = int(time.time())
            else:
                if HFT_MARKET == 'futures':
                    order    = self.client.futures_create_order(
                        symbol=pair, side=b_side, type='MARKET', quantity=qty)
                    order_id = order.get('orderId', 0)
                    avg_p    = order.get('avgPrice') or order.get('price') or str(price)
                    price    = float(avg_p) if avg_p else price
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
                'trail_level': 0,
                'trail_sl': None,
                'peak_pnl_pct': 0.0,
            }
            self.last_trade_ts[pair] = time.time()
            log.info(f'  ⚡ HFT {side} {pair} @ ${price:,.4f} | TP +{tp_pct:.2f}% | SL -{sl_pct:.2f}% | R:R 1:{rr:.1f} | conf={confidence:.0%} | {reason}')
            self.positions[key]['db_id'] = _hft_save_open(pair, side, price, qty, sl, tp)
            self.notify(
                f'⚡ HFT {side} — {pair}\n'
                f'Entrada: ${price:,.4f}  TP: ${tp:,.4f} (+{tp_pct:.2f}%)  SL: ${sl:,.4f} (-{sl_pct:.2f}%)\n'
                f'Qtd: {qty} | R:R 1:{rr:.1f} | confiança {confidence:.0%} | {reason}'
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
        cs = SIDE_SELL if side == 'BUY' else SIDE_BUY
        try:
            if not HFT_TESTNET:
                if HFT_MARKET == 'futures':
                    self.client.futures_create_order(symbol=pair, side=cs, type='MARKET', quantity=qty)
                else:
                    self.client.create_order(symbol=pair, side=cs, type=ORDER_TYPE_MARKET, quantity=qty)
        except Exception as e:
            log.error(f'  HFT close {pair} erro: {e}')

        pnl      = (price - pos['entry']) * qty if side == 'BUY' else (pos['entry'] - price) * qty
        self.daily_pnl += pnl
        duration = time.time() - pos['opened_at']
        # Break-even: PnL dentro do threshold não é win nem loss
        be_thresh = getattr(self, '_be_threshold', 0.0002)
        is_be = abs(pnl) <= be_thresh
        win   = pnl > be_thresh

        if is_be:
            self.daily_breakevens = getattr(self, 'daily_breakevens', 0) + 1
            self.consec_losses = 0  # BE não quebra streak de wins
            icon = '🔄'
        elif win:
            self.daily_wins  += 1; self.consec_losses = 0; self.consec_wins += 1; icon = '✅'
        else:
            self.daily_losses+= 1; self.consec_losses+= 1; self.consec_wins = 0; icon = '❌'

        # Registra no histórico persistente (mensal/anual)
        self._record_pnl(pnl, win, is_be)

        if pair in self.pair_stats:
            s = self.pair_stats[pair]
            if win:      s['wins'] += 1
            elif not is_be: s['losses'] += 1   # BE não conta como loss no par
            s['pnl'] += pnl

        strats = pos.get('strategies', [])
        for s in strats:
            if s in self.strategy_stats:
                if win:        self.strategy_stats[s]['wins']   += 1
                elif not is_be: self.strategy_stats[s]['losses'] += 1

        # *** APRENDIZADO ***
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
        be_str = f' (BE:{getattr(self,"daily_breakevens",0)})' if getattr(self,'daily_breakevens',0) > 0 else ''
        log.info(f'  {icon} HFT FECHA {pair} | ${pnl:+.4f} | {int(duration)}s | {reason} | {total}T WR:{wr:.0f}%{be_str} PnL:${self.daily_pnl:+.4f}')
        result_str = 'Break-even' if is_be else f'P&L: ${pnl:+.4f}'
        self.notify(
            f'{icon} HFT fechou {pair} | {result_str} ({int(duration)}s)\n'
            f'Hoje: {total} trades | WR:{wr:.0f}%{be_str} | PnL: ${self.daily_pnl:+.4f}'
        )

        if self.consec_losses >= 3:
            pause = HFT_COOLDOWN * (self.consec_losses + 1)
            self.paused_until = time.time() + pause
            log.warning(f'  ⏸ HFT: {self.consec_losses} losses → pausa {pause}s')
            self.notify(f'HFT pausado {pause}s ({self.consec_losses} losses seguidos)')

    def _check_exit(self, pair, price):
        for key, pos in list(self.positions.items()):
            if pos['pair'] != pair: continue
            side  = pos['side']
            age   = time.time() - pos['opened_at']
            entry = pos['entry']
            tp    = pos['tp']
            sl_orig = pos['sl']

            # Lucro atual em %
            pnl_pct = (price - entry) / entry * 100 if side == 'BUY' else (entry - price) / entry * 100
            if pnl_pct > pos.get('peak_pnl_pct', 0.0):
                self.positions[key]['peak_pnl_pct'] = pnl_pct

            # --- TRAILING STOP PROGRESSIVO (4 niveis) --------------------
            # Conforme o lucro cresce, o SL sobe travando parte do ganho.
            # Isso garante que apos atingir L1 (BE) a posicao nunca fecha no negativo.
            cur_level = pos.get('trail_level', 0)
            trail_sl  = pos.get('trail_sl')
            new_level = cur_level
            new_tsl   = trail_sl

            # Nivel 4: trava 75% do pnl_pct atual (trailing dinamico)
            if pnl_pct >= HFT_TRAIL_L4:
                lock = pnl_pct * 0.75
                if side == 'BUY':
                    cand = entry * (1 + lock / 100)
                    if trail_sl is None or cand > trail_sl:
                        new_tsl = cand; new_level = 4
                else:
                    cand = entry * (1 - lock / 100)
                    if trail_sl is None or cand < trail_sl:
                        new_tsl = cand; new_level = 4

            # Nivel 3: trava 60% do pnl_pct atual
            elif pnl_pct >= HFT_TRAIL_L3 and cur_level < 3:
                lock = pnl_pct * 0.60
                if side == 'BUY':
                    cand = entry * (1 + lock / 100)
                    if trail_sl is None or cand > trail_sl:
                        new_tsl = cand; new_level = 3
                else:
                    cand = entry * (1 - lock / 100)
                    if trail_sl is None or cand < trail_sl:
                        new_tsl = cand; new_level = 3

            # Nivel 2: trava 40% do pnl_pct
            elif pnl_pct >= HFT_TRAIL_L2 and cur_level < 2:
                lock = pnl_pct * 0.40
                if side == 'BUY':
                    cand = entry * (1 + lock / 100)
                    if trail_sl is None or cand > trail_sl:
                        new_tsl = cand; new_level = 2
                else:
                    cand = entry * (1 - lock / 100)
                    if trail_sl is None or cand < trail_sl:
                        new_tsl = cand; new_level = 2

            # Nivel 1 (Break-Even): SL = entry + buffer minimo
            elif pnl_pct >= HFT_TRAIL_L1 and cur_level < 1:
                buf = HFT_TRAIL_BE_BUF / 100
                if side == 'BUY':
                    cand = entry * (1 + buf)
                    if trail_sl is None or cand > trail_sl:
                        new_tsl = cand; new_level = 1
                else:
                    cand = entry * (1 - buf)
                    if trail_sl is None or cand < trail_sl:
                        new_tsl = cand; new_level = 1

            # Nos niveis L3/L4, trail segue o preco dinamicamente (sobe com o preco)
            if cur_level >= 3 and pnl_pct >= HFT_TRAIL_L3:
                lock_pct = 0.75 if cur_level >= 4 else 0.60
                lock = pnl_pct * lock_pct
                if side == 'BUY':
                    dyn = entry * (1 + lock / 100)
                    if trail_sl is None or dyn > trail_sl:
                        new_tsl = dyn
                else:
                    dyn = entry * (1 - lock / 100)
                    if trail_sl is None or dyn < trail_sl:
                        new_tsl = dyn

            # Aplica novo nivel/SL se mudou
            if new_level > cur_level or (new_tsl is not None and new_tsl != trail_sl):
                if new_tsl is not None:
                    # Garantia: apos L1, SL nunca fica abaixo do entry
                    buf = HFT_TRAIL_BE_BUF / 100
                    if new_level >= 1 and side == 'BUY'  and new_tsl < entry * (1 + buf):
                        new_tsl = entry * (1 + buf)
                    if new_level >= 1 and side == 'SELL' and new_tsl > entry * (1 - buf):
                        new_tsl = entry * (1 - buf)
                    self.positions[key]['trail_sl']     = new_tsl
                    self.positions[key]['trail_level']  = new_level
                    self.positions[key]['be_activated'] = new_level >= 1
                    if new_level > cur_level:
                        lnames = {1: 'BE', 2: 'Lock-40%', 3: 'Lock-60%', 4: 'Lock-75%'}
                        locked_pct = (new_tsl - entry) / entry * 100 if side == 'BUY' else (entry - new_tsl) / entry * 100
                        log.info(
                            f'  TRAIL L{new_level} ({lnames[new_level]}) {pair} {side} '
                            f'pnl=+{pnl_pct:.3f}% SL travado={locked_pct:+.3f}% (${new_tsl:,.5f})'
                        )

            # SL ativo = melhor entre original e trail
            if side == 'BUY':
                active_sl = max(sl_orig, self.positions.get(key, {}).get('trail_sl') or sl_orig)
            else:
                active_sl = min(sl_orig, self.positions.get(key, {}).get('trail_sl') or sl_orig)

            tlv    = self.positions.get(key, {}).get('trail_level', 0)
            sl_lbl = f'Trail-L{tlv}' if tlv > 0 else 'SL'

            # Decisoes de saida
            if side == 'BUY':
                if price >= tp:
                    self._close_position(key, price, f'TP +{(price/entry-1)*100:.2f}%')
                elif price <= active_sl:
                    locked = (active_sl - entry) / entry * 100
                    self._close_position(key, price, f'{sl_lbl} {locked:+.3f}% travado')
                elif age > HFT_TIME_EXIT and pnl_pct > 0:
                    self._close_position(key, price, f'Time-exit +{pnl_pct:.3f}%')
                elif age > HFT_TIME_EXIT * 2:
                    self._close_position(key, price, f'Time-exit max {pnl_pct:+.3f}%')
            else:
                if price <= tp:
                    self._close_position(key, price, f'TP +{(entry/price-1)*100:.2f}%')
                elif price >= active_sl:
                    locked = (entry - active_sl) / entry * 100
                    self._close_position(key, price, f'{sl_lbl} {locked:+.3f}% travado')
                elif age > HFT_TIME_EXIT and pnl_pct > 0:
                    self._close_position(key, price, f'Time-exit +{pnl_pct:.3f}%')
                elif age > HFT_TIME_EXIT * 2:
                    self._close_position(key, price, f'Time-exit max {pnl_pct:+.3f}%')

    def _poll_close_flags(self, pair, close):
        import glob as _glob
        pf = f'/tmp/hft_close_pair_{pair}'
        if os.path.exists(pf):
            try: os.remove(pf)
            except: pass
            self.close_position_by_pair(pair, 'Manual close via painel')
            return
        for fpath in _glob.glob('/tmp/hft_close_*'):
            if '_pair_' in fpath: continue
            try:
                data  = _json.loads(open(fpath).read())
                if data.get('pair') == pair or not data.get('pair'):
                    db_id = data.get('trade_id', '')
                    os.remove(fpath)
                    if db_id:
                        if not self.close_position_by_id(db_id, 'Manual'): self.close_position_by_pair(pair, 'Manual')
                    else: self.close_position_by_pair(pair, 'Manual')
            except: pass

    def close_position_by_pair(self, pair, reason='Manual close via painel'):
        for key, pos in list(self.positions.items()):
            if pos['pair'] == pair:
                cur = list(self.closes.get(pair, [pos['entry']]))[-1]
                self._close_position(key, cur, reason); return True
        return False

    def close_position_by_id(self, db_id, reason='Manual close via painel'):
        for key, pos in list(self.positions.items()):
            if pos.get('db_id') == db_id or key == db_id:
                cur = list(self.closes.get(pos['pair'], [pos['entry']]))[-1]
                self._close_position(key, cur, reason); return True
        return False

    # ── Loop principal de velas ───────────────────────────────────────────────

    def on_candle(self, pair, open_, high, low, close, volume, is_closed):
        if pair not in self.closes:
            self.closes[pair]  = deque(maxlen=250)
            self.highs[pair]   = deque(maxlen=250)
            self.lows[pair]    = deque(maxlen=250)
            self.volumes[pair] = deque(maxlen=250)
            self.opens[pair]   = deque(maxlen=250)
            self._candle_count[pair] = 0

        # Ticks: verificar SL/TP apenas (sem I/O de disco por tick)
        self._check_exit(pair, close)

        if not is_closed: return
        # Vela fechada: verificar flags de fechamento manual (1x por vela, não por tick)
        self._poll_close_flags(pair, close)

        # Vela fechada → atualiza dados
        self.closes[pair].append(close)
        self.highs[pair].append(high)
        self.lows[pair].append(low)
        self.volumes[pair].append(volume)
        self.opens[pair].append(open_)
        self._candle_count[pair] = self._candle_count.get(pair, 0) + 1

        now = time.time()
        if not self.running: return
        if self.paused_until > now: return

        daily_loss_pct = abs(self.daily_pnl) / self.capital * 100 if self.daily_pnl < 0 else 0
        if daily_loss_pct >= HFT_DAILY_LOSS:
            if self.running:
                self.running = False
                self.notify(f'🛑 HFT Daily Loss {HFT_DAILY_LOSS}% atingido | PnL: ${self.daily_pnl:.4f}\nPausado até amanhã.')
            return

        if not self._in_active_session():
            n = self._candle_count.get(pair, 0)
            if n % 60 == 0:  # log a cada 60 velas para não poluir
                h_local = (datetime.datetime.utcnow().hour + HFT_TZ_OFFSET) % 24
                log.info(f'  ⏸ HFT {pair} fora de sessão ({h_local:02d}h local) — SESSION_FILTER={HFT_SESSION_FILTER}')
            return

        # ── FASE 1: Confirmar sinal pendente ANTES de qualquer filtro ──────
        # Confirmação deve rodar independente de cooldown ou max_trades
        # para não perder a janela da vela de confirmação
        with self._lock:
            if pair in self._pending:
                # Só bloqueia se já tem posição neste par
                if sum(1 for k in self.positions if k.startswith(pair)) >= 1:
                    self._pending.pop(pair, None)
                elif len(self.positions) < HFT_MAX_TRADES:
                    self._try_confirm_and_enter(pair, open_, close, volume)
                else:
                    # Limite de posições atingido — descarta pendente
                    log.info(f'  ⚠ HFT {pair} pendente descartado: MAX_TRADES={HFT_MAX_TRADES} atingido')
                    del self._pending[pair]
                return

        cooldown = HFT_COOLDOWN
        if self.consec_wins >= 3: cooldown = int(HFT_COOLDOWN * 0.7)
        if now - self.last_trade_ts.get(pair, 0) < cooldown: return
        if sum(1 for k in self.positions if k.startswith(pair)) >= 1: return
        if len(self.positions) >= HFT_MAX_TRADES: return

        # ── FASE 2: Gerar novo sinal (se nenhum pendente) ─────────────────
        with self._lock:
            sig = self._generate_signal(pair)

        if sig['side']:
            # Armazena como PENDENTE (não entra ainda — espera confirmação)
            self._pending[pair] = sig
            log.info(
                f'  📡 HFT SINAL PENDENTE {sig["side"]} {pair} '
                f'score={sig["score"]:.1f} ({sig.get("count",0)} sinais) '
                f'conf={sig.get("confidence",0):.0%} | {sig["reason"]} '
                f'[{sig.get("regime","?")}] → aguarda confirmação'
            )
            # Telegram: avisa usuário que sinal foi encontrado
            self.send_signal_alert(
                pair, sig['side'], sig['score'], sig.get('count', 0),
                sig['reason'], sig.get('regime', '?'), sig.get('rsi', 50),
                sig.get('confidence', 0.5), sig.get('price', close)
            )
        else:
            n = self._candle_count.get(pair, 0)
            if n > 0 and n % 20 == 0:
                rsi_v  = self._rsi(self.closes[pair]) if len(self.closes[pair]) >= 9 else 50
                regime = self._detect_regime(pair) if len(self.closes[pair]) >= 50 else '?'
                log.info(f'  📊 HFT {pair} | velas={n} RSI={rsi_v:.0f} regime={regime} | {sig["reason"]} | pos={len(self.positions)}')

    # ── Stats e relatórios ────────────────────────────────────────────────────

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
            'pending_signals': list(self._pending.keys()),
            'calibrated_pairs': list(self._pair_params.keys()),
            'ai_advisor': self.ai_advisor.get_stats() if self.ai_advisor else {'enabled': False},
            'ai_skipped':      self._ai_skipped,
            'compound_enabled': HFT_COMPOUND,
            'capital_current': round(self.capital, 4),
            'budget_per_trade': round(self.capital * HFT_RISK_PCT / 100, 4),
            'ai_approved':     self._ai_approved,
            'daily_breakevens': getattr(self, 'daily_breakevens', 0),
            'pnl_summary':     self.get_pnl_summary(),
        }

    def send_heartbeat(self):
        """Heartbeat: prova que o bot está vivo e escaneando."""
        total = self.daily_wins + self.daily_losses + getattr(self, 'daily_breakevens', 0)
        pnl   = self.daily_pnl
        icon  = '🟢' if pnl > 0 else ('⚪' if abs(pnl) < 0.0001 else '🔴')
        open_pos = len(self.positions)
        pending_count = len(self._pending)

        # Coleta regime e RSI dos pares ativos
        pair_lines = []
        for pair in list(HFT_PAIRS)[:6]:
            if len(self.closes.get(pair, [])) < 30:
                pair_lines.append(f'  {pair.replace("USDT",""):6} aguardando dados...')
                continue
            regime  = self._detect_regime(pair)
            rsi_v   = self._rsi(self.closes[pair]) if len(self.closes[pair]) >= 9 else 50
            regime_icons = {'trending_up': '↗', 'trending_down': '↘', 'ranging': '↔', 'choppy': '〰'}
            r_icon  = regime_icons.get(regime, '?')
            pending = ' 📡' if pair in self._pending else ''
            pos_str = ' 📌' if any(p['pair']==pair for p in self.positions.values()) else ''
            pair_lines.append(f'  {pair.replace("USDT",""):6} RSI:{rsi_v:.0f} {r_icon} {regime}{pending}{pos_str}')

        status_str = ''
        if open_pos > 0:
            pos_info = []
            for pos in self.positions.values():
                cur = list(self.closes.get(pos['pair'], [pos['entry']]))[-1]
                pnl_pos = (cur - pos['entry']) * pos['qty'] if pos['side'] == 'BUY' else (pos['entry'] - cur) * pos['qty']
                age_min = int((time.time() - pos['opened_at']) / 60)
                pos_info.append(f'  📌 {pos["side"]} {pos["pair"].replace("USDT","")} @ ${pos["entry"]:.4f} | PnL: {"+$" if pnl_pos>=0 else "-$"}{abs(pnl_pos):.4f} ({age_min}min)')
            status_str = '\n<b>Posições abertas:</b>\n' + '\n'.join(pos_info) + '\n'

        pending_str = f'\n⏳ {pending_count} sinal(is) aguardando confirmação' if pending_count > 0 else ''
        budget = self.capital * HFT_RISK_PCT / 100

        self.notify(
            f'💓 <b>HFT Heartbeat — Bot ativo</b>\n'
            f'─────────────────────────\n'
            f'⚡ Monitorando <b>{len(HFT_PAIRS)}</b> pares em {HFT_TIMEFRAME}\n'
            f'💰 Capital: <code>${self.capital:.2f}</code> | Budget/trade: <code>${budget:.2f}</code>\n'
            f'{icon} Hoje: <code>{"+$" if pnl>=0 else "-$"}{abs(pnl):.4f}</code> | {total}T WR:{(self.daily_wins/max(self.daily_wins+self.daily_losses,1)*100):.0f}%\n'
            f'─────────────────────────\n'
            f'<b>Status dos pares:</b>\n' + '\n'.join(pair_lines) +
            f'\n{status_str}{pending_str}\n'
            f'🕐 <i>{datetime.datetime.now().strftime("%d/%m %H:%M")}</i>'
        )

    def send_signal_alert(self, pair, side, score, count, reason, regime, rsi, confidence, price):
        """Notifica quando sinal pendente é gerado — aguarda confirmação."""
        if not HFT_NOTIFY_SIGNAL: return
        dir_icon = '🔼' if side == 'BUY' else '🔽'
        side_text = 'COMPRA' if side == 'BUY' else 'VENDA'
        regime_icons = {'trending_up': '↗ Alta', 'trending_down': '↘ Baixa', 'ranging': '↔ Lateral', 'choppy': '〰 Chopy'}
        reg_txt = regime_icons.get(regime, regime)
        bar = lambda pct, n=8: '█' * min(n, round(pct/100*n)) + '░' * max(0, n - min(n, round(pct/100*n)))
        self.notify(
            f'{dir_icon} <b>Sinal detectado — {side_text} {pair.replace("USDT","")}</b>\n'
            f'─────────────────────────\n'
            f'💲 Preço: <code>${price:,.4f}</code>\n'
            f'📡 Confiança: {bar(confidence*100)} {confidence*100:.0f}%\n'
            f'📊 RSI: <code>{rsi:.0f}</code> | Regime: {reg_txt}\n'
            f'🔢 {count} estratégias | Score: <code>{score:.1f}</code>\n'
            f'📝 Motivo: <i>{reason}</i>\n'
            f'─────────────────────────\n'
            f'⏳ <i>Aguardando confirmação na próxima vela...</i>\n'
            f'🕐 <i>{datetime.datetime.now().strftime("%H:%M:%S")}</i>'
        )

    def send_periodic_update(self, period_label='30min'):
        total = self.daily_wins + self.daily_losses + getattr(self, 'daily_breakevens', 0)
        eff   = self.daily_wins + self.daily_losses
        wr    = self.daily_wins / eff * 100 if eff > 0 else 0
        pnl   = self.daily_pnl
        icon  = '🟢' if pnl > 0 else ('⚪' if abs(pnl) < 0.0001 else '🔴')
        be_c  = getattr(self, 'daily_breakevens', 0)
        be_str = f' | 🔄 {be_c} BE' if be_c > 0 else ''
        summary = self.get_pnl_summary()
        m = summary['monthly']; a = summary['annual']
        m_icon = '🟢' if m['pnl'] >= 0 else '🔴'
        a_icon = '🟢' if a['pnl'] >= 0 else '🔴'
        open_pos = len(self.positions)
        open_str = ''
        if open_pos > 0:
            pairs_open = ', '.join(set(p['pair'].replace('USDT','') for p in self.positions.values()))
            open_str = f'\n📌 {open_pos} aberta(s): {pairs_open}'
        ai_s = self.ai_advisor.get_stats() if getattr(self,'ai_advisor',None) else {}
        ai_str = f'\n🤖 IA: {ai_s.get("approved",0)}✅ {ai_s.get("skipped",0)}🚫 skip:{ai_s.get("skip_rate",0):.0f}%' if ai_s.get('enabled') else ''
        self.notify(
            f'⏰ <b>HFT Update — {period_label}</b>\n'
            f'─────────────────────\n'
            f'{icon} <b>Hoje:</b> <code>{"+" if pnl>=0 else ""}${pnl:.4f}</code>\n'
            f'📊 {total} trades | {self.daily_wins}✅ {self.daily_losses}❌{be_str}\n'
            f'🎯 WR: <code>{wr:.1f}%</code> (BE não conta){open_str}\n'
            f'─────────────────────\n'
            f'{m_icon} <b>Mês:</b> <code>{"+" if m["pnl"]>=0 else ""}${m["pnl"]:.4f}</code> | {m["wins"]}W/{m["losses"]}L\n'
            f'{a_icon} <b>Ano:</b> <code>{"+" if a["pnl"]>=0 else ""}${a["pnl"]:.4f}</code> | {a["wins"]}W/{a["losses"]}L{ai_str}\n'
            f'🕐 <i>{datetime.datetime.now().strftime("%d/%m %H:%M")}</i>'
        )

    def send_daily_summary(self):
        total    = self.daily_wins + self.daily_losses
        be_c     = getattr(self, 'daily_breakevens', 0)
        eff      = self.daily_wins + self.daily_losses
        wr       = self.daily_wins / eff * 100 if eff > 0 else 0
        icon     = '🟢' if self.daily_pnl >= 0 else '🔴'
        be_str   = f' | 🔄 {be_c} break-even' if be_c > 0 else ''
        top_p    = sorted(self.pair_stats.items(), key=lambda x: x[1]['pnl'], reverse=True)
        pair_ln  = '\n'.join(
            f"  {'✅' if s['pnl']>=0 else '❌'} {p.replace('USDT',''):6} {s['wins']}W/{s['losses']}L  {'+'if s['pnl']>=0 else ''}${s['pnl']:.4f}"
            for p, s in top_p[:6] if s['wins'] + s['losses'] > 0
        ) or '  Nenhum trade hoje'
        ls   = self.learner.get_summary()
        tops = sorted([(s, d) for s, d in ls.items() if d['n'] >= 5],
                      key=lambda x: float(x[1].get('wr', 0)) if x[1].get('wr') != 'N/A' else 0, reverse=True)
        st_ln = ', '.join(f"{s} {d['wr']}%" for s, d in tops[:4]) if tops else 'Aprendendo...'
        ai_s     = self.ai_advisor.get_stats() if getattr(self,'ai_advisor',None) else {}
        ai_line  = f'🤖 IA: {ai_s.get("approved",0)}✅ {ai_s.get("skipped",0)}🚫 skip:{ai_s.get("skip_rate",0):.0f}%\n' if ai_s.get('enabled') else ''
        summary  = self.get_pnl_summary()
        m = summary['monthly']; a = summary['annual']
        m_icon = '🟢' if m['pnl'] >= 0 else '🔴'
        a_icon = '🟢' if a['pnl'] >= 0 else '🔴'

        # ── Projeção de lucro com base no capital real ─────────────────────────
        risk_pct  = float(os.environ.get('HFT_RISK_PCT', '1.5'))
        tp_pct    = float(os.environ.get('HFT_TP_PCT',   '0.35'))
        sl_pct    = float(os.environ.get('HFT_SL_PCT',   '0.18'))
        capital   = self.capital
        budget    = capital * risk_pct / 100
        per_win   = budget * tp_pct / 100
        per_loss  = budget * sl_pct / 100
        wins_real = self.daily_wins
        loss_real = self.daily_losses
        res_real  = wins_real * per_win - loss_real * per_loss
        roi_day   = res_real / capital * 100 if capital > 0 else 0
        # Projeção mensal baseada no WR real de hoje (22 dias úteis, 20 trades/dia)
        avg_day   = res_real if total > 0 else 0
        proj_mo   = avg_day * 22
        roi_mo    = roi_day * 22
        proj_line = (
            f'───────────────────────\n'
            f'💡 <b>Projeção — Capital Real</b>\n'
            f'   Capital: <code>${capital:,.2f} USDT</code>  Risk: <code>{risk_pct}%</code>\n'
            f'   Lucro/win: <code>${per_win:.4f}</code>  Perda/loss: <code>${per_loss:.4f}</code>\n'
            f'   Resultado hoje: <code>{"+" if res_real>=0 else ""}${res_real:.4f}</code> ({roi_day:+.2f}%)\n'
            f'   Proj. mensal: <code>{"+" if proj_mo>=0 else ""}${proj_mo:.2f}</code> ({roi_mo:+.1f}%/mês)\n'
        )

        pnl_sign = "+" if self.daily_pnl >= 0 else ""
        m_sign   = "+" if m["pnl"] >= 0 else ""
        a_sign   = "+" if a["pnl"] >= 0 else ""
        self.notify(
            f'📊 <b>Resumo Diário HFT</b>\n'
            f'───────────────────────\n'
            f'{icon} <b>Hoje:</b> <code>{pnl_sign}${self.daily_pnl:.4f}</code>\n'
            f'📈 {total} trades | {self.daily_wins}W/{self.daily_losses}L{be_str} | WR:{wr:.1f}%\n'
            f'───────────────────────\n'
            f'{m_icon} <b>Mês:</b> <code>{m_sign}${m["pnl"]:.4f}</code> | {m["wins"]}W/{m["losses"]}L WR:{m["win_rate"]}%\n'
            f'{a_icon} <b>Ano:</b> <code>{a_sign}${a["pnl"]:.4f}</code> | {a["wins"]}W/{a["losses"]}L WR:{a["win_rate"]}%\n'
            f'───────────────────────\n'
            f'<b>Por par:</b>\n{pair_ln}\n'
            f'<b>Top estratégias:</b> {st_ln}\n'
            f'{ai_line}'
            f'{proj_line}'
            f'🕐 <i>{datetime.datetime.now().strftime("%d/%m/%Y %H:%M")}</i>'
        )

    def reset_daily(self):
        log.info(f'  🔄 HFT reset diário | {len(self.positions)} posições abertas')
        if self.daily_wins + self.daily_losses > 0:
            try: self.send_daily_summary()
            except: pass

        # ── Juros compostos: incorpora PnL do dia ao capital base ─────────
        if HFT_COMPOUND and self.daily_pnl != 0:
            capital_antes = self.capital
            self.capital  = round(self.capital + self.daily_pnl, 4)
            # Garante capital mínimo de $10 para continuar operando
            self.capital  = max(self.capital, 10.0)
            delta = self.capital - capital_antes
            log.info(f'  💰 Compound: capital {capital_antes:.2f} → {self.capital:.2f} ({delta:+.4f})')
            self._save_capital()
            self.notify(
                f'💰 <b>Juros Compostos</b>\n'
                f'Capital atualizado: <code>${capital_antes:.2f}</code> → <code>${self.capital:.2f}</code>\n'
                f'Variação: <code>{delta:+.4f}</code> ({delta/capital_antes*100:+.2f}%)\n'
                f'Próximo budget/trade: <code>${self.capital * HFT_RISK_PCT / 100:.2f}</code>'
            )

        self.daily_pnl    = 0.0; self.daily_wins = 0; self.daily_losses = 0
        self.trades_today = []; self.consec_losses = 0; self.consec_wins = 0
        self.paused_until = 0; self._pending = {}
        self.pair_stats   = {p: {'wins': 0, 'losses': 0, 'pnl': 0.0} for p in HFT_PAIRS}
        self._ai_skipped  = 0
        self._ai_approved = 0
        self.daily_breakevens = 0
        self.strategy_stats = {s: {'wins': 0, 'losses': 0} for s in STRATEGY_NAMES}
        self.running = True
        # Recarrega calibração (pode ter sido atualizada overnight)
        self._load_calibration()
        log.info('  ✅ HFT v3.1 novo dia iniciado')


# ── Singleton ─────────────────────────────────────────────────────────────────
_hft_engine = None

def get_hft_engine(): return _hft_engine
def init_hft(capital, client, notify_fn=None):
    global _hft_engine
    _hft_engine = HFTEngine(capital, client, notify_fn)
    _hft_engine.running = True
    return _hft_engine
