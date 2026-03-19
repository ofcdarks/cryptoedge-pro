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

# Analytics Engine
try:
    from hft_analytics import get_analytics, HFTAnalytics
    _ANALYTICS_OK = True
except ImportError:
    _ANALYTICS_OK = False
    def get_analytics(): return None

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
HFT_TP_PCT       = float(os.environ.get('HFT_TP_PCT',      '0.80'))  # Referência para cálculo de viabilidade (NÃO é teto)
HFT_SL_PCT       = float(os.environ.get('HFT_SL_PCT',      '0.35'))  # 0.35% SL inicial fixo
# ── Trail Stop SEMPRE ATIVO — SEM TP FIXO, LUCRO ILIMITADO ───────────────────
# 7 FASES: L0=SL fixo → L1=BE → L2=Lock30% → L3=Lock50% → L4=Lock65% → L5=Lock75% → L6=Lock80%
# Preço sobe → trail sobe travando lucro. Preço recua → fecha no trail (lucro garantido).
HFT_TRAIL_ENABLED = True  # sempre ativo — motor principal de saída
HFT_TRAIL_L1 = float(os.environ.get('HFT_TRAIL_L1', '0.25'))  # break-even (cobre taxa + margem)
HFT_TRAIL_L2 = float(os.environ.get('HFT_TRAIL_L2', '0.40'))  # lock 30%
HFT_TRAIL_L3 = float(os.environ.get('HFT_TRAIL_L3', '0.60'))  # lock 50%
HFT_TRAIL_L4 = float(os.environ.get('HFT_TRAIL_L4', '1.00'))  # lock 65%
HFT_TRAIL_L5 = float(os.environ.get('HFT_TRAIL_L5', '1.50'))  # lock 75%
HFT_TRAIL_L6 = float(os.environ.get('HFT_TRAIL_L6', '2.50'))  # lock 80% (trailing dinâmico)
HFT_TRAIL_BE_BUF = float(os.environ.get('HFT_TRAIL_BE_BUF', '0.02'))  # buffer acima da taxa p/ BE
HFT_NO_TP_CEILING = os.environ.get('HFT_NO_TP_CEILING', 'true').lower() == 'true'
HFT_RISK_PCT     = float(os.environ.get('HFT_RISK_PCT',    '15.0')) # 15% — budget suficiente para cobrir taxas
HFT_MAX_TRADES   = int(os.environ.get('HFT_MAX_TRADES',    '5'))   # era 3 → mais oportunidades
HFT_DAILY_LOSS   = float(os.environ.get('HFT_DAILY_LOSS',  '3.0'))
# ── Daily Loss DINÂMICO: loss máximo = lucro do dia anterior ─────────────────
# Nunca perde mais do que ganhou. Se ontem fez +$1.29, hoje pode perder max $1.29
# Fallback: se não tem dado anterior, usa HFT_DAILY_LOSS_FALLBACK_PCT do capital
HFT_DYNAMIC_DAILY_LOSS     = os.environ.get('HFT_DYNAMIC_DAILY_LOSS', 'true').lower() == 'true'
HFT_DAILY_LOSS_FALLBACK_PCT = float(os.environ.get('HFT_DAILY_LOSS_FALLBACK_PCT', '2.0'))  # % se não tem dado
HFT_DAILY_LOSS_MIN         = float(os.environ.get('HFT_DAILY_LOSS_MIN', '0.20'))  # mínimo $ p/ não travar o bot
# ── Daily Profit Protector — preserva lucro do dia ───────────────────────────
# Sem meta de gain (roda o dia inteiro), mas protege o lucro acumulado.
# Quando PnL do dia atinge threshold → ativa trailing diário.
# Se PnL cair do pico e perder X% do lucro → para no dia com lucro garantido.
HFT_DAILY_PROTECT_THRESHOLD = float(os.environ.get('HFT_DAILY_PROTECT_THRESHOLD', '0.50'))  # $ mínimo p/ ativar proteção
HFT_DAILY_PROTECT_PCT       = float(os.environ.get('HFT_DAILY_PROTECT_PCT',       '60'))    # % do pico a proteger
HFT_DAILY_PROTECT_ENABLED   = os.environ.get('HFT_DAILY_PROTECT_ENABLED', 'true').lower() == 'true'
HFT_COOLDOWN     = int(os.environ.get('HFT_COOLDOWN',      '45'))
HFT_TIME_EXIT    = int(os.environ.get('HFT_TIME_EXIT',     '1800'))  # 30min — tempo para TP 1.5% em 3m
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

# ── Filtro de Amplitude e Lucro Mínimo ───────────────────────────────────────
HFT_MIN_ATR_PCT    = float(os.environ.get('HFT_MIN_ATR_PCT',    '0.10'))  # ATR mínimo por vela (%)
HFT_MIN_NET_PROFIT = float(os.environ.get('HFT_MIN_NET_PROFIT', '0.08'))  # lucro líquido mínimo ($)
HFT_FEE_RATE       = float(os.environ.get('HFT_FEE_RATE',       '0.0005'))# taxa taker 0.05% (Binance futures)
# ── Slippage Buffer — protege contra diferença entre preço visto e executado ──
# Slippage estimado em % do preço. Com posições pequenas (~$50-170), slippage é ~0.10-0.20%
# O bot só permite fechar trade se: lucro bruto > taxa + slippage estimado
HFT_SLIPPAGE_PCT   = float(os.environ.get('HFT_SLIPPAGE_PCT',   '0.15'))  # 0.15% slippage estimado
HFT_SLIPPAGE_LEARN = os.environ.get('HFT_SLIPPAGE_LEARN', 'true').lower() == 'true'  # aprende com trades reais
HFT_LEVERAGE       = int(os.environ.get('HFT_LEVERAGE',          '5'))     # alavancagem Binance
# Pula confirmação de vela (entra direto no sinal) — útil em tendências fortes
HFT_SKIP_CONFIRM = os.environ.get('HFT_SKIP_CONFIRM', 'false').lower() == 'true'  # confirmação de vela ativa
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

# ── MELHORIA 1: Filtro de Correlação ─────────────────────────────────────────
# Max posições na mesma direção (BUY ou SELL) — evita risco triplicado
HFT_MAX_SAME_DIRECTION = int(os.environ.get('HFT_MAX_SAME_DIRECTION', '2'))

# ── MELHORIA 2: Multi-Timeframe (confirma 3m com 15m) ───────────────────────
HFT_MTF_ENABLED   = os.environ.get('HFT_MTF_ENABLED', 'true').lower() == 'true'
HFT_MTF_TIMEFRAME = os.environ.get('HFT_MTF_TIMEFRAME', '15m')
HFT_MTF_KLINES    = int(os.environ.get('HFT_MTF_KLINES', '50'))

# ── MELHORIA 3: Funding Rate Filter ─────────────────────────────────────────
HFT_FUNDING_ENABLED = os.environ.get('HFT_FUNDING_ENABLED', 'true').lower() == 'true'
HFT_FUNDING_WEIGHT  = float(os.environ.get('HFT_FUNDING_WEIGHT', '0.5'))  # peso extra no score

# ── MELHORIA 6: Blacklist Dinâmica Agressiva ─────────────────────────────────
HFT_BLACKLIST_CONSEC_LOSSES = int(os.environ.get('HFT_BLACKLIST_CONSEC', '3'))
HFT_BLACKLIST_PAUSE_SEC     = int(os.environ.get('HFT_BLACKLIST_PAUSE', '7200'))  # 2h
HFT_BLACKLIST_MIN_WR        = float(os.environ.get('HFT_BLACKLIST_MIN_WR', '35'))  # WR% mínimo

# ── MELHORIA 8: Alerta de Volatilidade Extrema ──────────────────────────────
HFT_VOLATILITY_PAUSE_PCT  = float(os.environ.get('HFT_VOL_PAUSE_PCT', '3.0'))  # BTC cai X% em 1h
HFT_VOLATILITY_PAUSE_SEC  = int(os.environ.get('HFT_VOL_PAUSE_SEC', '1800'))   # pausa 30min

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
        # ── Daily Profit Protector ────────────────────────────────────
        self.peak_daily_pnl      = 0.0    # pico de PnL do dia
        self.daily_protect_active = False  # proteção ativada?
        self.daily_protect_floor  = 0.0   # piso mínimo de PnL (trail diário)
        self.daily_protect_stopped = False # parou por proteção de lucro?
        # ── Dynamic Daily Loss: loss max = lucro anterior ─────────────
        self.prev_day_profit     = self._load_prev_day_profit()
        self.dynamic_loss_limit  = self._calc_dynamic_loss_limit()
        # ── MELHORIA 1: Correlação ────────────────────────────────────
        # (usa self.positions para contar direção — já existe)
        # ── MELHORIA 2: Multi-Timeframe cache ─────────────────────────
        self._mtf_cache = {}  # par → {'trend': 'up'|'down'|'neutral', 'ts': timestamp}
        self._mtf_cache_ttl = 180  # refresh a cada 3min
        # ── MELHORIA 3: Funding Rate cache ────────────────────────────
        self._funding_cache = {}  # par → {'rate': float, 'ts': timestamp}
        self._funding_cache_ttl = 300  # refresh a cada 5min
        # ── MELHORIA 6: Blacklist dinâmica ────────────────────────────
        self._pair_consec_losses = {p: 0 for p in HFT_PAIRS}
        self._pair_blacklist = {}  # par → timestamp até quando está pausado
        # ── MELHORIA 8: Volatilidade BTC ──────────────────────────────
        self._btc_prices = deque(maxlen=20)  # últimos preços BTC p/ detectar crash
        self._volatility_paused_until = 0
        # ── Slippage tracker (aprende com trades reais) ───────────────
        self._slippage_history = deque(maxlen=100)  # últimos 100 slippages em %
        self._slippage_by_pair = {}  # par → deque de slippages
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
        _ai_default = os.environ.get('HFT_AI_ENABLED', 'true').lower() == 'true'  # ativado por padrão
        self.ai_advisor = (get_ai_advisor() if _AI_MODULE_OK else None) if _ai_default else None
        self._ai_skipped = 0    # trades ignorados pela IA
        self._ai_approved = 0   # trades aprovados pela IA

        # ── Analytics (histórico de performance por par/hora)
        try:
            self.analytics = get_analytics() if _ANALYTICS_OK else None
        except Exception:
            self.analytics = None

        # ── Juros compostos: carrega capital persistido da sessão anterior ──
        if HFT_COMPOUND:
            self.capital = self._load_capital()

        self._last_pos_sync = 0  # timestamp última sincronização de posições com Binance

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

        # ── FILTRO CRÍTICO: não entra se não cobrir a taxa ──────────────────
        # Calcula taxa real round-trip + lucro mínimo exigido
        budget_v     = self.capital * HFT_RISK_PCT / 100
        position_v   = budget_v * HFT_LEVERAGE
        fee_rt_usdt  = position_v * HFT_FEE_RATE * 2          # taxa entrada + saída em $
        min_gross    = fee_rt_usdt + HFT_MIN_NET_PROFIT        # mínimo bruto = taxa + lucro mínimo
        min_tp_pct   = min_gross / position_v * 100             # % mínimo do TP

        # Bloqueia se o TP configurado não cobre taxa + lucro mínimo
        if HFT_TP_PCT < min_tp_pct:
            return {'side': None, 'score': 0,
                    'reason': f'TP {HFT_TP_PCT}% não cobre taxa ${fee_rt_usdt:.3f} + lucro mín ${HFT_MIN_NET_PROFIT} (precisa ≥{min_tp_pct:.2f}%)',
                    'strategies': []}

        # Bloqueia se ATR atual é menor que o mínimo para atingir o TP
        atr_check     = self._atr(highs, lows, closes)
        atr_pct_check = atr_check / close * 100 if close > 0 else 0
        # ATR mínimo = pelo menos 15% do TP (apenas garante que mercado não está morto)
        atr_min_for_tp = HFT_TP_PCT * 0.15
        if atr_pct_check < max(HFT_MIN_ATR_PCT, atr_min_for_tp):
            return {'side': None, 'score': 0,
                    'reason': f'{pair.replace("USDT","")} sem amplitude ATR={atr_pct_check:.3f}% — não cobre taxa ${fee_rt_usdt:.3f}',
                    'strategies': []}

        # ADX mínimo: só opera em mercado com alguma direção
        adx_min = float(os.environ.get('HFT_ADX_MIN', '12'))
        adx_cur = self._adx(highs, lows, closes)
        if adx_cur < adx_min:
            return {'side': None, 'score': 0, 'reason': f'ADX {adx_cur:.0f} < {adx_min:.0f} (mercado sem direção)', 'strategies': []}

        # Parâmetros calibrados para este par
        rsi_buy  = self._get_pair_param(pair, 'rsi_buy',  float(os.environ.get('HFT_RSI_BUY', '22.0')))
        rsi_sell = self._get_pair_param(pair, 'rsi_sell', float(os.environ.get('HFT_RSI_SELL', '78.0')))
        vol_mult = self._get_pair_param(pair, 'vol_mult',  1.5)
        min_sc   = self._get_pair_param(pair, 'min_score', float(os.environ.get('HFT_MIN_SCORE', '3.5')))
        min_sg   = self._get_pair_param(pair, 'min_signals', int(os.environ.get('HFT_MIN_SIGNALS', '3')))

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
            if bw_v > 0.06:  # relaxado para 3m (era 0.12)
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
            # Counter-trend: BUY em tendência de baixa → precisa score 30% maior
            if regime == 'trending_down' and buy_score < min_sc * 1.3:
                return {'side': None, 'score': 0, 'strategies': [],
                        'reason': f'BUY contra-tendência precisa score>{min_sc*1.3:.1f} (tem {buy_score:.1f})'}
            # Ranging: usa RSI configurável (env HFT_RANGING_RSI_BUY, default=rsi_buy)
            ranging_rsi_buy = float(os.environ.get('HFT_RANGING_RSI_BUY', str(rsi_buy)))
            if regime == 'ranging' and rsi_v > ranging_rsi_buy:
                return {'side': None, 'score': 0, 'strategies': [],
                        'reason': f'BUY ranging RSI {rsi_v:.0f} > {ranging_rsi_buy:.0f}'}
            # Funding rate bonus/penalidade
            funding_adj = self._funding_score_adjustment(pair, 'BUY')
            buy_score += funding_adj
            return {'side': 'BUY', 'score': buy_score, 'count': buy_count,
                    'reason': ' + '.join(buy_reasons[:3]) + (f' +funding' if funding_adj > 0 else ''),
                    'strategies': list(set(buy_strats)),
                    'regime': regime, 'rsi': rsi_v, 'price': close,
                    'confidence': min(buy_score / 6.0, 1.0)}

        if sell_count >= min_sg and sell_score >= min_sc and sell_score > buy_score * 1.4:
            if HFT_ONLY_BUY:
                return {'side': None, 'score': 0, 'strategies': [],
                        'reason': f'SELL ignorado (HFT_ONLY_BUY=true) [{regime}]'}
            # Counter-trend: SELL em tendência de alta → precisa score 30% maior
            if regime == 'trending_up' and sell_score < min_sc * 1.3:
                return {'side': None, 'score': 0, 'strategies': [],
                        'reason': f'SELL contra-tendência precisa score>{min_sc*1.3:.1f} (tem {sell_score:.1f})'}
            # Ranging: usa RSI configurável (env HFT_RANGING_RSI_SELL, default=rsi_sell)
            ranging_rsi_sell = float(os.environ.get('HFT_RANGING_RSI_SELL', str(rsi_sell)))
            if regime == 'ranging' and rsi_v < ranging_rsi_sell:
                return {'side': None, 'score': 0, 'strategies': [],
                        'reason': f'SELL ranging RSI {rsi_v:.0f} < {ranging_rsi_sell:.0f}'}
            # Funding rate bonus/penalidade
            funding_adj = self._funding_score_adjustment(pair, 'SELL')
            sell_score += funding_adj
            return {'side': 'SELL', 'score': sell_score, 'count': sell_count,
                    'reason': ' + '.join(sell_reasons[:3]) + (f' +funding' if funding_adj > 0 else ''),
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
            self.notify(
                f'⚠️ {side} {pair.replace("USDT","")} descartado — preço fugiu\n'
                f'Sinal: ${origin_price:,.4f} | Atual: ${close:,.4f}\n'
                f'Drift: {drift:.2f}% > limite {HFT_CONFIRM_MAX_DRIFT}%\n'
                f'💡 O mercado se moveu demais antes da confirmação'
            )
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
                    self.notify(
                        f'⏳ {side} {pair.replace("USDT","")} — aguardando +1 vela\n'
                        f'Preço: ${close:,.4f} | Conf: {confidence:.0%}\n'
                        f'💡 Vela não confirmou ainda — tentativa {attempts}/2'
                    )
                    return False
                elif confidence >= 0.75 and attempts > 1:
                    log.info(f'  ➡️ HFT {pair} {side} 2ª tentativa conf {confidence:.0%} — entrando sem confirmação de vela')
                    self.notify(
                        f'➡️ {side} {pair.replace("USDT","")} — entrando na 2ª tentativa\n'
                        f'Preço: ${close:,.4f} | Conf: {confidence:.0%} ≥ 75%\n'
                        f'💡 Vela neutra aceita em alta confiança'
                    )
                    # Continua para entrada
                else:
                    log.info(f'  ✗ HFT {pair} {side} NÃO confirmado conf={confidence:.0%} → descartado')
                    direction = 'caiu' if side == 'BUY' else 'subiu'
                    self.notify(
                        f'❌ {side} {pair.replace("USDT","")} descartado — vela contrária\n'
                        f'Preço: ${close:,.4f} | Conf: {confidence:.0%}\n'
                        f'💡 Vela {direction} após o sinal — mercado rejeitou a direção'
                    )
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
                if HFT_MARKET == 'futures':
                    # Futuros USD-M: usa futures_exchange_info
                    info = self.client.futures_exchange_info()
                    sym  = next((s for s in info['symbols'] if s['symbol'] == pair), None)
                    if sym:
                        lot = next(f for f in sym['filters'] if f['filterType'] == 'LOT_SIZE')
                        mnt = next((f for f in sym['filters'] if f['filterType'] == 'MIN_NOTIONAL'), {})
                        self._sym_info[pair] = {
                            'min_qty':      float(lot['minQty']),
                            'step':         float(lot['stepSize']),
                            'min_notional': float(mnt.get('notional', 5.0)),
                        }
                        log.info(f'  📐 {pair} futures: step={lot["stepSize"]} min_qty={lot["minQty"]}')
                    else:
                        raise ValueError(f'{pair} não encontrado em futures_exchange_info')
                else:
                    # Spot
                    info = self.client.get_symbol_info(pair)
                    lot  = next(f for f in info['filters'] if f['filterType'] == 'LOT_SIZE')
                    self._sym_info[pair] = {
                        'min_qty': float(lot['minQty']),
                        'step':    float(lot['stepSize']),
                        'min_notional': 10.0,
                    }
            except Exception as e:
                log.warning(f'  sym_info {pair}: {e} — usando fallback')
                # Fallbacks realistas por tipo de mercado
                fallbacks = {
                    'BTCUSDT':  (0.001, 0.001, 100.0),
                    'ETHUSDT':  (0.01,  0.01,  20.0),
                    'BNBUSDT':  (0.01,  0.01,  5.0),
                    'SOLUSDT':  (0.1,   0.1,   5.0),
                    'XRPUSDT':  (1.0,   1.0,   5.0),
                    'DOGEUSDT': (1.0,   1.0,   5.0),
                    'ADAUSDT':  (1.0,   1.0,   5.0),
                    'AVAXUSDT': (0.1,   0.1,   5.0),
                    'DOTUSDT':  (0.1,   0.1,   5.0),
                    'MATICUSDT':(1.0,   1.0,   5.0),
                    # ── Novos pares adicionados ──
                    'SUIUSDT':  (0.1,   0.1,   5.0),
                    'NEARUSDT': (0.1,   0.1,   5.0),
                    'PEPEUSDT': (1.0,   1.0,   5.0),
                    '1000PEPEUSDT':(1.0, 1.0,  5.0),
                    'WIFUSDT':  (0.1,   0.1,   5.0),
                    'SHIBUSDT': (1.0,   1.0,   5.0),
                    'FETUSDT':  (0.1,   0.1,   5.0),
                    'LINKUSDT': (0.01,  0.01,  5.0),
                    'TRXUSDT':  (1.0,   1.0,   5.0),
                    'APTUSDT':  (0.1,   0.1,   5.0),
                    'ARBUSDT':  (0.1,   0.1,   5.0),
                    'FILUSDT':  (0.1,   0.1,   5.0),
                    'RENDERUSDT':(0.1,  0.1,   5.0),
                }
                fb = fallbacks.get(pair, (1.0, 1.0, 5.0))
                self._sym_info[pair] = {'min_qty': fb[0], 'step': fb[1], 'min_notional': fb[2]}
        return self._sym_info[pair]

    def _round_step(self, v, step):
        sd = Decimal(str(step)).normalize(); vd = Decimal(str(v))
        qd = (vd // sd) * sd
        return float(round(qd, max(0, -sd.as_tuple().exponent)))

    def _calc_qty(self, pair, price, confidence=0.5):
        """MELHORIA 4: Position sizing proporcional ao score/confiança."""
        if price <= 0: return 0
        info = self._get_sym_info(pair)
        # Escala mais agressiva: conf 0.3→0.6x, conf 0.5→1.0x, conf 0.8→1.4x, conf 1.0→1.7x
        risk_mult = 0.4 + confidence * 1.3
        risk_mult = min(risk_mult, 1.7)  # teto 1.7x para sinais excepcionais
        # Reduz após losses consecutivos
        if self.consec_losses >= 3: risk_mult *= 0.5
        elif self.consec_losses >= 2: risk_mult *= 0.7
        # Bônus: par com WR alto no analytics
        if self.analytics:
            try:
                ps = self.analytics.get_pair_status(pair)
                if ps.get('trades', 0) >= 8 and ps.get('win_rate', 50) > 65:
                    risk_mult *= 1.15  # +15% para pares comprovados
            except Exception:
                pass
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
                    # avgPrice pode vir "0" no market order — busca o preço real
                    avg_p = float(order.get('avgPrice') or 0)
                    if avg_p <= 0:
                        # Busca o preço atual como fallback
                        try:
                            tk = self.client.futures_symbol_ticker(symbol=pair)
                            avg_p = float(tk.get('price', price))
                        except:
                            avg_p = price
                    price = avg_p
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
            tp_label = f'Trail (ref +{tp_pct:.2f}%)' if HFT_NO_TP_CEILING else f'TP +{tp_pct:.2f}%'
            log.info(f'  ⚡ HFT {side} {pair} @ ${price:,.4f} | {tp_label} | SL -{sl_pct:.2f}% | conf={confidence:.0%} | {reason}')
            self.positions[key]['db_id'] = _hft_save_open(pair, side, price, qty, sl, tp)
            self.notify(
                f'⚡ HFT {side} — {pair}\n'
                f'Entrada: ${price:,.4f}  SL: ${sl:,.4f} (-{sl_pct:.2f}%)\n'
                f'{"🚀 Sem teto de lucro — trailing ativo" if HFT_NO_TP_CEILING else f"TP: ${tp:,.4f} (+{tp_pct:.2f}%)"}\n'
                f'Qtd: {qty} | confiança {confidence:.0%} | {reason}'
            )
            return True
        except Exception as e:
            err_str = str(e)
            log.error(f'  HFT {pair} {side} ERRO: {err_str}')
            self.notify(
                f'❌ ERRO ao executar {side} {pair.replace("USDT","")}\n'
                f'Preço: ${price:,.4f} | Qty: {qty}\n'
                f'Erro Binance: {err_str[:200]}'
            )
            return False

    def _close_position(self, key, price, reason):
        pos = self.positions.get(key)
        if not pos: return
        pair = pos['pair']; side = pos['side']; qty = pos['qty']

        from binance.enums import SIDE_BUY, SIDE_SELL, ORDER_TYPE_MARKET
        cs = SIDE_SELL if side == 'BUY' else SIDE_BUY
        actual_price = price  # fallback
        try:
            if not HFT_TESTNET:
                if HFT_MARKET == 'futures':
                    order = self.client.futures_create_order(symbol=pair, side=cs, type='MARKET', quantity=qty)
                    # Captura preço REAL de execução
                    avg_p = float(order.get('avgPrice') or 0)
                    if avg_p > 0:
                        actual_price = avg_p
                else:
                    order = self.client.create_order(symbol=pair, side=cs, type=ORDER_TYPE_MARKET, quantity=qty)
                    fills = order.get('fills', [])
                    if fills:
                        actual_price = sum(float(f['price'])*float(f['qty']) for f in fills) / \
                                       sum(float(f['qty']) for f in fills)

                # ── Registra slippage real ────────────────────────────────
                if HFT_SLIPPAGE_LEARN and actual_price != price:
                    slip_pct = abs(actual_price - price) / price * 100
                    self._slippage_history.append(slip_pct)
                    if pair not in self._slippage_by_pair:
                        self._slippage_by_pair[pair] = deque(maxlen=30)
                    self._slippage_by_pair[pair].append(slip_pct)
                    if slip_pct > 0.05:
                        log.info(f'  📉 SLIPPAGE {pair}: esperado ${price:.4f} → real ${actual_price:.4f} ({slip_pct:.3f}%)')
        except Exception as e:
            err_str = str(e)
            log.error(f'  HFT close {pair} erro: {err_str}')
            self.notify(
                f'❌ ERRO ao fechar {side} {pair.replace("USDT","")}\n'
                f'Erro Binance: {err_str[:200]}\n'
                f'⚠️ Feche manualmente na Binance!'
            )

        # Usa preço REAL de execução para PnL
        pnl      = (actual_price - pos['entry']) * qty if side == 'BUY' else (pos['entry'] - actual_price) * qty
        self.daily_pnl += pnl
        self._update_daily_profit_protection()
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

        # MELHORIA 6: Blacklist dinâmica
        self._record_pair_result(pair, win or is_be)

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

        # ── Analytics: registra trade completa ───────────────────────────
        if self.analytics:
            try:
                fee_est = abs(pos.get('qty', 0) * price * HFT_FEE_RATE * 2)  # taxa real round-trip
                rsi_rec = self._rsi(self.closes.get(pair, [])) if len(self.closes.get(pair, [])) >= 9 else 50
                adx_rec = self._adx(self.highs.get(pair, []), self.lows.get(pair, []), self.closes.get(pair, []))
                vol_recs = list(self.volumes.get(pair, []))
                avg_v = sum(vol_recs[-6:-1]) / 5 if len(vol_recs) >= 6 else 1
                vol_r = vol_recs[-1] / avg_v if avg_v > 0 and vol_recs else 1.0
                tp_p  = abs(pos.get('tp', price) - pos.get('entry', price)) / pos.get('entry', price) * 100 if pos.get('entry') else 0
                sl_p  = abs(pos.get('sl', price) - pos.get('entry', price)) / pos.get('entry', price) * 100 if pos.get('entry') else 0
                self.analytics.record(
                    pair=pair, side=side,
                    entry=pos.get('entry', 0), exit_price=price,
                    qty=pos.get('qty', 0),
                    pnl_gross=pnl, fee=fee_est, duration_sec=duration,
                    rsi=rsi_rec, adx=adx_rec,
                    regime=self._detect_regime(pair) if len(self.closes.get(pair,[])) >= 50 else 'unknown',
                    volume_ratio=vol_r, score=pos.get('confidence', 0.5),
                    confidence=pos.get('confidence', 0.5),
                    strategies=pos.get('strategies', []),
                    entry_reason=pos.get('reason', ''), exit_reason=reason,
                    tp_pct=tp_p, sl_pct=sl_p,
                )
            except Exception as _ae:
                log.debug(f'Analytics record error: {_ae}')
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

    def _sync_positions_with_binance(self):
        """Verifica posições abertas na Binance e fecha as que já foram liquidadas ou atingiram SL/TP."""
        if HFT_MARKET != 'futures' or HFT_TESTNET: return
        now = time.time()
        if now - self._last_pos_sync < 30: return  # no máximo a cada 30s
        self._last_pos_sync = now
        try:
            binance_positions = {
                p['symbol']: p for p in self.client.futures_position_information()
                if float(p.get('positionAmt', 0)) != 0
            }
            for key, pos in list(self.positions.items()):
                pair = pos['pair']
                # Se par não tem mais posição na Binance → foi liquidada ou fechada
                if pair not in binance_positions:
                    log.warning(f'  ⚠ {pair} não encontrado nas posições Binance — fechando internamente')
                    cur = list(self.closes.get(pair, [pos['entry']]))[-1]
                    self._close_position(key, cur, 'Sync: posição não encontrada na Binance')
                else:
                    bp = binance_positions[pair]
                    real_entry = float(bp.get('entryPrice', 0))
                    real_pnl   = float(bp.get('unRealizedProfit', 0))
                    # Atualiza entry se estava zero
                    if pos['entry'] <= 0 and real_entry > 0:
                        atr_v = self._atr(self.highs.get(pair, []), self.lows.get(pair, []), self.closes.get(pair, []))
                        if atr_v <= 0: atr_v = real_entry * 0.002
                        sl_d = max(atr_v, real_entry * HFT_SL_PCT / 100)
                        tp_d = max(atr_v * 2, sl_d * HFT_MIN_RR)
                        side = pos['side']
                        self.positions[key]['entry'] = real_entry
                        self.positions[key]['sl'] = real_entry - sl_d if side == 'BUY' else real_entry + sl_d
                        self.positions[key]['tp'] = real_entry + tp_d if side == 'BUY' else real_entry - tp_d
                        log.info(f'  🔧 Sync {pair}: entry=${real_entry:.4f} PnL=${real_pnl:+.4f}')
        except Exception as e:
            log.debug(f'  Sync Binance erro: {e}')

    # ══════════════════════════════════════════════════════════════════════════
    # MELHORIAS 1-8: Filtros avançados de proteção e otimização
    # ══════════════════════════════════════════════════════════════════════════

    # ── MELHORIA 1: Filtro de Correlação ─────────────────────────────────────
    def _check_correlation_limit(self, side):
        """Retorna True se pode abrir posição nesta direção (max N na mesma dir)."""
        same_dir = sum(1 for p in self.positions.values() if p['side'] == side)
        if same_dir >= HFT_MAX_SAME_DIRECTION:
            log.info(f'  🔗 CORRELAÇÃO: {same_dir} posições {side} abertas ≥ {HFT_MAX_SAME_DIRECTION} → bloqueado')
            return False
        return True

    # ── MELHORIA 2: Multi-Timeframe ─────────────────────────────────────────
    def _get_mtf_trend(self, pair):
        """Busca tendência no timeframe maior (15m) via API Binance."""
        if not HFT_MTF_ENABLED:
            return 'neutral'
        now = time.time()
        cached = self._mtf_cache.get(pair)
        if cached and now - cached['ts'] < self._mtf_cache_ttl:
            return cached['trend']
        try:
            if HFT_MARKET == 'futures':
                klines = self.client.futures_klines(symbol=pair, interval=HFT_MTF_TIMEFRAME, limit=HFT_MTF_KLINES)
            else:
                klines = self.client.get_klines(symbol=pair, interval=HFT_MTF_TIMEFRAME, limit=HFT_MTF_KLINES)
            if not klines or len(klines) < 20:
                return 'neutral'
            closes = [float(k[4]) for k in klines]
            ema8  = self._ema(closes[-8:], 8)
            ema21 = self._ema(closes[-21:], 21)
            rsi   = self._rsi(closes)
            close = closes[-1]
            if ema8 > ema21 * 1.001 and close > ema21 and rsi > 45:
                trend = 'up'
            elif ema8 < ema21 * 0.999 and close < ema21 and rsi < 55:
                trend = 'down'
            else:
                trend = 'neutral'
            self._mtf_cache[pair] = {'trend': trend, 'ts': now}
            return trend
        except Exception as e:
            log.debug(f'  MTF {pair}: {e}')
            return 'neutral'

    def _mtf_agrees(self, pair, side):
        """Verifica se timeframe maior concorda com a direção."""
        if not HFT_MTF_ENABLED:
            return True
        trend = self._get_mtf_trend(pair)
        if trend == 'neutral':
            return True  # neutro não bloqueia
        if side == 'BUY' and trend == 'down':
            log.info(f'  📊 MTF {pair}: 15m bearish → BUY bloqueado')
            return False
        if side == 'SELL' and trend == 'up':
            log.info(f'  📊 MTF {pair}: 15m bullish → SELL bloqueado')
            return False
        return True

    # ── MELHORIA 3: Funding Rate Filter ─────────────────────────────────────
    def _get_funding_rate(self, pair):
        """Busca funding rate atual do par."""
        if not HFT_FUNDING_ENABLED or HFT_MARKET != 'futures':
            return 0.0
        now = time.time()
        cached = self._funding_cache.get(pair)
        if cached and now - cached['ts'] < self._funding_cache_ttl:
            return cached['rate']
        try:
            data = self.client.futures_funding_rate(symbol=pair, limit=1)
            if data:
                rate = float(data[-1].get('fundingRate', 0))
                self._funding_cache[pair] = {'rate': rate, 'ts': now}
                return rate
        except Exception:
            pass
        return 0.0

    def _funding_score_adjustment(self, pair, side):
        """Retorna ajuste de score baseado no funding rate."""
        if not HFT_FUNDING_ENABLED or HFT_MARKET != 'futures':
            return 0.0
        rate = self._get_funding_rate(pair)
        # Funding positivo = longs pagam shorts → favorece SELL
        # Funding negativo = shorts pagam longs → favorece BUY
        if side == 'BUY' and rate < -0.0001:
            return HFT_FUNDING_WEIGHT  # bônus: shorts estão pagando
        elif side == 'SELL' and rate > 0.0001:
            return HFT_FUNDING_WEIGHT  # bônus: longs estão pagando
        elif side == 'BUY' and rate > 0.0003:
            return -HFT_FUNDING_WEIGHT * 0.5  # penalidade: longs pagam muito
        elif side == 'SELL' and rate < -0.0003:
            return -HFT_FUNDING_WEIGHT * 0.5  # penalidade: shorts pagam muito
        return 0.0

    # ── MELHORIA 4: Position Sizing por Score (integrado em _calc_qty) ──────
    # Já existe parcialmente — _calc_qty usa confidence.
    # Melhoria: mapear score diretamente para risk_mult

    # ── MELHORIA 6: Blacklist Dinâmica Agressiva ────────────────────────────
    def _record_pair_result(self, pair, win):
        """Registra resultado e aplica blacklist se necessário."""
        if win:
            self._pair_consec_losses[pair] = 0
            # Remove da blacklist se ganhou
            self._pair_blacklist.pop(pair, None)
        else:
            self._pair_consec_losses[pair] = self._pair_consec_losses.get(pair, 0) + 1
            if self._pair_consec_losses[pair] >= HFT_BLACKLIST_CONSEC_LOSSES:
                until = time.time() + HFT_BLACKLIST_PAUSE_SEC
                self._pair_blacklist[pair] = until
                mins = HFT_BLACKLIST_PAUSE_SEC // 60
                log.warning(f'  ⛔ BLACKLIST {pair}: {self._pair_consec_losses[pair]} losses seguidos → pausado {mins}min')
                self.notify(
                    f'⛔ {pair.replace("USDT","")} pausado por {mins}min\n'
                    f'{self._pair_consec_losses[pair]} losses seguidos\n'
                    f'💡 Volta automaticamente em {mins}min'
                )

    def _is_pair_blacklisted(self, pair):
        """Retorna True se par está na blacklist."""
        until = self._pair_blacklist.get(pair, 0)
        if until > 0:
            if time.time() < until:
                return True
            else:
                self._pair_blacklist.pop(pair, None)
                self._pair_consec_losses[pair] = 0
                log.info(f'  ✅ {pair} saiu da blacklist')
        # WR check: se analytics disponível e WR muito baixo
        if self.analytics:
            try:
                ps = self.analytics.get_pair_status(pair)
                if ps.get('trades', 0) >= 10 and ps.get('win_rate', 50) < HFT_BLACKLIST_MIN_WR:
                    return True
            except Exception:
                pass
        return False

    # ── MELHORIA 8: Alerta de Volatilidade Extrema ──────────────────────────
    def _check_btc_volatility(self):
        """Monitora BTC para flash crashes. Pausa bot se queda > X% em 1h."""
        if self._volatility_paused_until > time.time():
            return True  # ainda pausado
        try:
            btc_closes = self.closes.get('BTCUSDT', deque())
            if len(btc_closes) < 20:
                return False
            # Compara preço atual com preço de 20 velas atrás (~1h em 3m)
            current = btc_closes[-1]
            past = btc_closes[-20]
            change_pct = (current - past) / past * 100
            if abs(change_pct) >= HFT_VOLATILITY_PAUSE_PCT:
                self._volatility_paused_until = time.time() + HFT_VOLATILITY_PAUSE_SEC
                direction = 'QUEDA' if change_pct < 0 else 'ALTA'
                mins = HFT_VOLATILITY_PAUSE_SEC // 60
                log.warning(f'  🚨 VOLATILIDADE: BTC {direction} {change_pct:+.1f}% em 1h → pausa {mins}min')
                self.notify(
                    f'🚨 <b>Volatilidade extrema — BTC {direction} {change_pct:+.1f}%</b>\n'
                    f'Bot pausado {mins}min para proteger capital\n'
                    f'💡 Volta automaticamente às {datetime.datetime.now().strftime("%H:%M")}'
                )
                return True
        except Exception:
            pass
        return False

    # ── MELHORIA 7: Resumo Semanal (chamado pela visibility thread) ─────────
    def send_weekly_summary(self):
        """Resumo semanal com estatísticas detalhadas."""
        try:
            summary = self.get_pnl_summary()
            m = summary.get('monthly', {})
            stats = self.get_stats()
            learning = stats.get('learning', {})

            # Top/bottom pares
            pair_data = []
            for period_data in self._pnl_data.get('daily', {}).values():
                pass  # dados já estão no monthly

            # Top estratégias
            tops = sorted([(s,d) for s,d in learning.items() if isinstance(d, dict) and d.get('n',0)>=5],
                          key=lambda x: float(x[1].get('wr',0)) if x[1].get('wr')!='N/A' else 0, reverse=True)
            top_str = '\n'.join(f'  ✅ {s}: {d["wr"]}% ({d["n"]} trades)' for s,d in tops[:4]) or '  Sem dados'
            bot_str = '\n'.join(f'  ❌ {s}: {d["wr"]}% ({d["n"]} trades)' for s,d in tops[-2:]) or '  Sem dados'

            roi_m = m.get('pnl', 0) / self.capital * 100 if self.capital > 0 else 0
            self.notify(
                f'📊 <b>Resumo Semanal HFT</b>\n'
                f'═══════════════════════\n'
                f'💰 Capital: <code>${self.capital:.2f}</code>\n'
                f'📈 PnL mês: <code>{"+$" if m.get("pnl",0)>=0 else "-$"}{abs(m.get("pnl",0)):.4f}</code> ({roi_m:+.1f}%)\n'
                f'🎯 WR: {m.get("win_rate",0):.1f}% | {m.get("wins",0)}W/{m.get("losses",0)}L\n'
                f'═══════════════════════\n'
                f'<b>Melhores estratégias:</b>\n{top_str}\n'
                f'<b>Piores:</b>\n{bot_str}\n'
                f'═══════════════════════\n'
                f'🛡 Loss dinâmico: ${self.dynamic_loss_limit:.2f}\n'
                f'💹 Compound: {"ATIVO" if HFT_COMPOUND else "OFF"}\n'
                f'🕐 <i>{datetime.datetime.now().strftime("%d/%m/%Y %H:%M")}</i>'
            )
        except Exception as e:
            log.debug(f'Weekly summary error: {e}')

    # ── Dynamic Daily Loss ──────────────────────────────────────────────────────

    def _load_prev_day_profit(self) -> float:
        """Carrega lucro do dia anterior (persistido no reset)."""
        try:
            f = os.environ.get('HFT_PREV_PROFIT_FILE', '/data/hft_prev_day_profit.json')
            if os.path.exists(f):
                with open(f) as fh:
                    data = _json.load(fh)
                    return float(data.get('profit', 0))
        except Exception:
            pass
        return 0.0

    def _save_prev_day_profit(self, profit: float):
        """Salva lucro do dia para ser usado como loss limit amanhã."""
        try:
            f = os.environ.get('HFT_PREV_PROFIT_FILE', '/data/hft_prev_day_profit.json')
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, 'w') as fh:
                _json.dump({
                    'profit': round(profit, 4),
                    'date': datetime.datetime.now().strftime('%Y-%m-%d'),
                    'capital': round(self.capital, 2),
                }, fh)
        except Exception:
            pass

    def _calc_dynamic_loss_limit(self) -> float:
        """Calcula loss limit dinâmico: min(lucro anterior, % fixo do capital)."""
        if not HFT_DYNAMIC_DAILY_LOSS:
            return self.capital * HFT_DAILY_LOSS / 100

        prev = self.prev_day_profit
        fallback = self.capital * HFT_DAILY_LOSS_FALLBACK_PCT / 100

        if prev > 0:
            # Loss max = lucro do dia anterior (nunca perde mais que ganhou)
            limit = max(prev, HFT_DAILY_LOSS_MIN)
            log.info(f'  📊 Daily Loss dinâmico: ${limit:.4f} (lucro anterior: ${prev:.4f})')
        else:
            # Sem lucro anterior → usa fallback conservador
            limit = max(fallback, HFT_DAILY_LOSS_MIN)
            log.info(f'  📊 Daily Loss fallback: ${limit:.4f} ({HFT_DAILY_LOSS_FALLBACK_PCT}% de ${self.capital:.2f})')

        return limit

    # ── Daily Profit Protector ─────────────────────────────────────────────────
    def _update_daily_profit_protection(self):
        """Atualiza trailing diário — protege lucro acumulado sem limitar ganho."""
        if not HFT_DAILY_PROTECT_ENABLED:
            return

        pnl = self.daily_pnl

        # Atualiza pico do dia
        if pnl > self.peak_daily_pnl:
            self.peak_daily_pnl = pnl

        # Ativa proteção quando lucro atinge threshold
        if not self.daily_protect_active and pnl >= HFT_DAILY_PROTECT_THRESHOLD:
            self.daily_protect_active = True
            self.daily_protect_floor = pnl * HFT_DAILY_PROTECT_PCT / 100
            log.info(f'  🛡 DAILY PROTECT ativado: PnL ${pnl:.4f} ≥ ${HFT_DAILY_PROTECT_THRESHOLD} | piso=${self.daily_protect_floor:.4f}')
            self.notify(
                f'🛡 Proteção diária ATIVADA\n'
                f'Lucro atual: ${pnl:.4f}\n'
                f'Piso protegido: ${self.daily_protect_floor:.4f} ({HFT_DAILY_PROTECT_PCT:.0f}%)\n'
                f'💡 Bot continua operando — se lucro cair até o piso, para no dia'
            )

        # Atualiza piso conforme pico sobe (trailing)
        if self.daily_protect_active:
            new_floor = self.peak_daily_pnl * HFT_DAILY_PROTECT_PCT / 100
            if new_floor > self.daily_protect_floor:
                old_floor = self.daily_protect_floor
                self.daily_protect_floor = new_floor
                # Notifica a cada $0.30+ de subida no piso
                if new_floor - old_floor >= 0.30:
                    log.info(f'  🛡 DAILY PROTECT trail: pico=${self.peak_daily_pnl:.4f} → piso=${new_floor:.4f}')
                    self.notify(
                        f'📈 Proteção diária atualizada\n'
                        f'Pico do dia: ${self.peak_daily_pnl:.4f}\n'
                        f'Novo piso: ${new_floor:.4f} ({HFT_DAILY_PROTECT_PCT:.0f}%)\n'
                        f'💡 Lucro mínimo garantido subiu'
                    )

            # Verifica se PnL caiu abaixo do piso
            if pnl <= self.daily_protect_floor and pnl < self.peak_daily_pnl:
                if not self.daily_protect_stopped:
                    self.daily_protect_stopped = True
                    self.running = False
                    log.warning(
                        f'  🛡 DAILY PROTECT STOP: PnL ${pnl:.4f} ≤ piso ${self.daily_protect_floor:.4f} '
                        f'(pico foi ${self.peak_daily_pnl:.4f})'
                    )
                    self.notify(
                        f'🛡 Proteção diária — PAROU\n'
                        f'Pico do dia: ${self.peak_daily_pnl:.4f}\n'
                        f'Lucro preservado: ${pnl:.4f}\n'
                        f'Piso: ${self.daily_protect_floor:.4f}\n'
                        f'💰 Lucro do dia protegido! Bot volta amanhã.'
                    )

    def _is_daily_profit_protected(self):
        """Retorna True se o bot deve parar de abrir novas posições."""
        return self.daily_protect_stopped

    def _check_exit(self, pair, price):
        for key, pos in list(self.positions.items()):
            if pos['pair'] != pair: continue
            side  = pos['side']
            age   = time.time() - pos['opened_at']
            entry = pos['entry']

            # Corrige posições abertas com preço zero (bug de captura de avgPrice)
            if entry <= 0:
                log.info(f'  🔧 HFT {pair} corrigindo entry=0 → usando preço atual ${price:,.4f}')
                atr_v = self._atr(self.highs[pair], self.lows[pair], self.closes[pair])
                if atr_v <= 0: atr_v = price * 0.002
                min_rr = self._get_pair_param(pair, 'min_rr', HFT_MIN_RR)
                sl_d   = max(atr_v, price * HFT_SL_PCT / 100)
                tp_d   = max(atr_v * 2, sl_d * min_rr)
                new_sl = price - sl_d if side == 'BUY' else price + sl_d
                new_tp = price + tp_d if side == 'BUY' else price - tp_d
                self.positions[key]['entry'] = price
                self.positions[key]['sl']    = new_sl
                self.positions[key]['tp']    = new_tp
                # Atualiza no DB
                try:
                    p = _json.dumps({'id': pos.get('db_id'), 'entry': price, 'sl': new_sl, 'tp': new_tp}).encode()
                    r = urllib.request.Request(f'{_APP_URL}/api/bot/trade/fix-entry', data=p,
                                               headers=_BOT_HEADER, method='POST')
                    urllib.request.urlopen(r, timeout=3)
                except: pass
                entry = price
                log.info(f'  ✅ {pair} entry corrigido: ${price:,.4f} TP:${new_tp:,.4f} SL:${new_sl:,.4f}')

            tp    = pos['tp']  # referência, NÃO é teto de saída
            sl_orig = pos['sl']

            # Lucro atual em %
            pnl_pct = (price - entry) / entry * 100 if side == 'BUY' else (entry - price) / entry * 100
            if pnl_pct > pos.get('peak_pnl_pct', 0.0):
                self.positions[key]['peak_pnl_pct'] = pnl_pct

            # ── TRAILING STOP PROGRESSIVO (7 fases) — SEM TP FIXO ──────────
            # Fases: L0=SL fixo → L1=BE → L2=30% → L3=50% → L4=65% → L5=75% → L6=80%
            # O lucro NUNCA é limitado: trail sobe junto com o preço.
            cur_level = pos.get('trail_level', 0)
            trail_sl  = pos.get('trail_sl')
            new_level = cur_level
            new_tsl   = trail_sl

            # Custo de taxa em % para cálculo de break-even real
            fee_pct_rt = HFT_FEE_RATE * 2 * 100  # ex: 0.05% × 2 = 0.10%

            # ── Fase L6: Lock 80% (trailing dinâmico contínuo) ───────────
            if pnl_pct >= HFT_TRAIL_L6:
                lock = pnl_pct * 0.80
                cand = entry * (1 + lock / 100) if side == 'BUY' else entry * (1 - lock / 100)
                if side == 'BUY' and (trail_sl is None or cand > trail_sl):
                    new_tsl = cand; new_level = max(new_level, 6)
                elif side == 'SELL' and (trail_sl is None or cand < trail_sl):
                    new_tsl = cand; new_level = max(new_level, 6)

            # ── Fase L5: Lock 75% ────────────────────────────────────────
            elif pnl_pct >= HFT_TRAIL_L5:
                lock = pnl_pct * 0.75
                cand = entry * (1 + lock / 100) if side == 'BUY' else entry * (1 - lock / 100)
                if side == 'BUY' and (trail_sl is None or cand > trail_sl):
                    new_tsl = cand; new_level = max(new_level, 5)
                elif side == 'SELL' and (trail_sl is None or cand < trail_sl):
                    new_tsl = cand; new_level = max(new_level, 5)

            # ── Fase L4: Lock 65% ────────────────────────────────────────
            elif pnl_pct >= HFT_TRAIL_L4:
                lock = pnl_pct * 0.65
                cand = entry * (1 + lock / 100) if side == 'BUY' else entry * (1 - lock / 100)
                if side == 'BUY' and (trail_sl is None or cand > trail_sl):
                    new_tsl = cand; new_level = max(new_level, 4)
                elif side == 'SELL' and (trail_sl is None or cand < trail_sl):
                    new_tsl = cand; new_level = max(new_level, 4)

            # ── Fase L3: Lock 50% ────────────────────────────────────────
            elif pnl_pct >= HFT_TRAIL_L3:
                lock = pnl_pct * 0.50
                cand = entry * (1 + lock / 100) if side == 'BUY' else entry * (1 - lock / 100)
                if side == 'BUY' and (trail_sl is None or cand > trail_sl):
                    new_tsl = cand; new_level = max(new_level, 3)
                elif side == 'SELL' and (trail_sl is None or cand < trail_sl):
                    new_tsl = cand; new_level = max(new_level, 3)

            # ── Fase L2: Lock 30% ────────────────────────────────────────
            elif pnl_pct >= HFT_TRAIL_L2 and cur_level < 2:
                lock = pnl_pct * 0.30
                cand = entry * (1 + lock / 100) if side == 'BUY' else entry * (1 - lock / 100)
                if side == 'BUY' and (trail_sl is None or cand > trail_sl):
                    new_tsl = cand; new_level = 2
                elif side == 'SELL' and (trail_sl is None or cand < trail_sl):
                    new_tsl = cand; new_level = 2

            # ── Fase L1: Break-Even (cobre taxa + slippage + buffer) ────────
            elif pnl_pct >= HFT_TRAIL_L1 and cur_level < 1:
                est_pos_val = pos['qty'] * price
                est_fee_pct = (est_pos_val * HFT_FEE_RATE * 2) / est_pos_val * 100 if est_pos_val > 0 else fee_pct_rt
                # Inclui slippage estimado no cálculo de BE
                pair_slips = self._slippage_by_pair.get(pair)
                slip_pct = sum(pair_slips) / len(pair_slips) if pair_slips and len(pair_slips) >= 3 else HFT_SLIPPAGE_PCT
                be_offset = max(est_fee_pct, fee_pct_rt) + slip_pct + HFT_TRAIL_BE_BUF
                cand = entry * (1 + be_offset / 100) if side == 'BUY' else entry * (1 - be_offset / 100)
                if side == 'BUY' and (trail_sl is None or cand > trail_sl):
                    new_tsl = cand; new_level = 1
                elif side == 'SELL' and (trail_sl is None or cand < trail_sl):
                    new_tsl = cand; new_level = 1

            # Trail dinâmico contínuo para L4+ (acompanha o preço em tempo real)
            if cur_level >= 4 and pnl_pct > 0:
                lock_pcts = {4: 0.65, 5: 0.75, 6: 0.80}
                lock_pct = lock_pcts.get(cur_level, 0.65)
                lock = pnl_pct * lock_pct
                dyn = entry * (1 + lock / 100) if side == 'BUY' else entry * (1 - lock / 100)
                if side == 'BUY' and (trail_sl is None or dyn > trail_sl):
                    new_tsl = dyn
                elif side == 'SELL' and (trail_sl is None or dyn < trail_sl):
                    new_tsl = dyn

            # Aplica novo nível/SL se mudou
            if new_tsl is not None and (new_level > cur_level or new_tsl != trail_sl):
                # Garantia: após L1, SL nunca fica abaixo do break-even
                be_offset = fee_pct_rt + HFT_TRAIL_BE_BUF
                if new_level >= 1 and side == 'BUY' and new_tsl < entry * (1 + be_offset / 100):
                    new_tsl = entry * (1 + be_offset / 100)
                if new_level >= 1 and side == 'SELL' and new_tsl > entry * (1 - be_offset / 100):
                    new_tsl = entry * (1 - be_offset / 100)
                self.positions[key]['trail_sl']     = new_tsl
                self.positions[key]['trail_level']  = new_level
                self.positions[key]['be_activated'] = new_level >= 1
                if new_level > cur_level:
                    lnames = {1:'BE', 2:'Lock-30%', 3:'Lock-50%', 4:'Lock-65%', 5:'Lock-75%', 6:'Lock-80%'}
                    locked_pct = (new_tsl - entry) / entry * 100 if side == 'BUY' else (entry - new_tsl) / entry * 100
                    log.info(
                        f'  🔒 TRAIL L{new_level} ({lnames.get(new_level,"?")}) {pair} {side} '
                        f'pnl=+{pnl_pct:.3f}% trail={locked_pct:+.3f}% (${new_tsl:,.5f})'
                    )
                    if new_level >= 2:
                        self.notify(
                            f'🔒 Trail L{new_level} — {pair.replace("USDT","")}\n'
                            f'Lucro atual: +{pnl_pct:.2f}% | Travado: {locked_pct:+.2f}%\n'
                            f'Trail SL: ${new_tsl:,.4f} | Entrada: ${entry:,.4f}\n'
                            f'💡 Lucro protegido — sem teto, continua subindo'
                        )

            # ── SL ativo = melhor entre trail e SL original ──────────────
            if side == 'BUY':
                active_sl = max(sl_orig, self.positions.get(key, {}).get('trail_sl') or sl_orig)
            else:
                active_sl = min(sl_orig, self.positions.get(key, {}).get('trail_sl') or sl_orig)

            tlv    = self.positions.get(key, {}).get('trail_level', 0)
            sl_lbl = f'Trail-L{tlv}' if tlv > 0 else 'SL'

            # ── FEE+SLIPPAGE GATE: lucro deve cobrir taxa E slippage ────
            position_val = pos['qty'] * price
            fee_rt_real  = position_val * HFT_FEE_RATE * 2  # taxa round-trip
            # Slippage estimado: usa histórico real se disponível, senão config
            pair_slips = self._slippage_by_pair.get(pair)
            if pair_slips and len(pair_slips) >= 3:
                avg_slip_pct = sum(pair_slips) / len(pair_slips)
            else:
                avg_slip_pct = HFT_SLIPPAGE_PCT
            slippage_est = position_val * avg_slip_pct / 100
            total_cost   = fee_rt_real + slippage_est  # custo total para fechar
            pnl_gross    = (price - entry) * pos['qty'] if side == 'BUY' else (entry - price) * pos['qty']
            pnl_net      = pnl_gross - total_cost

            # ── Decisões de saída — SEM TP FIXO ──────────────────────────
            if side == 'BUY':
                if not HFT_NO_TP_CEILING and price >= tp:
                    self._close_position(key, price, f'TP +{(price/entry-1)*100:.2f}%')
                elif price <= active_sl:
                    # FEE+SLIP GATE: trail diz fechar mas lucro não cobre custos reais
                    if tlv > 0 and pnl_net < 0 and price > sl_orig:
                        log.info(f'  🛡 SLIP GATE {pair}: lucro ${pnl_gross:.4f} < custo ${total_cost:.4f} (fee ${fee_rt_real:.4f} + slip ${slippage_est:.4f}) — aguardando')
                    else:
                        locked = (active_sl - entry) / entry * 100
                        self._close_position(key, price, f'{sl_lbl} {locked:+.3f}% net:${pnl_net:+.4f}')
                elif age > HFT_TIME_EXIT * 3 and pnl_pct <= 0:
                    self._close_position(key, price, f'Time-exit max (loss) {pnl_pct:+.3f}%')
            else:
                if not HFT_NO_TP_CEILING and price <= tp:
                    self._close_position(key, price, f'TP +{(entry/price-1)*100:.2f}%')
                elif price >= active_sl:
                    if tlv > 0 and pnl_net < 0 and price < sl_orig:
                        log.info(f'  🛡 SLIP GATE {pair}: lucro ${pnl_gross:.4f} < custo ${total_cost:.4f} (fee ${fee_rt_real:.4f} + slip ${slippage_est:.4f}) — aguardando')
                    else:
                        locked = (entry - active_sl) / entry * 100
                        self._close_position(key, price, f'{sl_lbl} {locked:+.3f}% net:${pnl_net:+.4f}')
                elif age > HFT_TIME_EXIT * 3 and pnl_pct <= 0:
                    self._close_position(key, price, f'Time-exit max (loss) {pnl_pct:+.3f}%')

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
        # Sincronização periódica com Binance (max 1x a cada 30s)
        self._sync_positions_with_binance()

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

        # ── Daily Loss DINÂMICO: loss max = lucro do dia anterior ────────
        if self.daily_pnl < 0:
            loss_abs = abs(self.daily_pnl)
            if loss_abs >= self.dynamic_loss_limit:
                if self.running:
                    self.running = False
                    reason = f'lucro anterior ${self.prev_day_profit:.2f}' if self.prev_day_profit > 0 else f'fallback {HFT_DAILY_LOSS_FALLBACK_PCT}%'
                    self.notify(
                        f'🛑 Daily Loss atingido\n'
                        f'Perda: -${loss_abs:.4f} ≥ limite ${self.dynamic_loss_limit:.4f}\n'
                        f'Regra: {reason}\n'
                        f'💡 Nunca perde mais do que ganhou. Bot volta amanhã.'
                    )
                return

        # ── Daily Profit Protector: não abre novos trades se lucro protegido ──
        if self._is_daily_profit_protected():
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
        secs_since = now - self.last_trade_ts.get(pair, 0)
        if secs_since < cooldown:
            log.debug(f'  ⏳ {pair} cooldown {int(cooldown-secs_since)}s restantes')
            return
        if sum(1 for k in self.positions if k.startswith(pair)) >= 1:
            log.debug(f'  ⛔ {pair} já tem posição aberta')
            return
        if len(self.positions) >= HFT_MAX_TRADES:
            self.notify(f'⛔ MAX_TRADES={HFT_MAX_TRADES} atingido — aguardando fechar posição')
            return

        # ── MELHORIA 6: Blacklist check ──────────────────────────────────────
        if self._is_pair_blacklisted(pair):
            return

        # ── MELHORIA 8: Volatilidade extrema ─────────────────────────────────
        if self._check_btc_volatility():
            return

        # ── FASE 2: Gerar novo sinal (se nenhum pendente) ─────────────────
        with self._lock:
            sig = self._generate_signal(pair)

        if sig['side']:
            # ── MELHORIA 1: Filtro de correlação ────────────────────────────
            if not self._check_correlation_limit(sig['side']):
                self.notify(
                    f'🔗 {sig["side"]} {pair.replace("USDT","")} bloqueado — correlação\n'
                    f'Já tem {HFT_MAX_SAME_DIRECTION} posições {sig["side"]} abertas'
                )
                return

            # ── MELHORIA 2: Multi-timeframe ─────────────────────────────────
            if not self._mtf_agrees(pair, sig['side']):
                self.notify(
                    f'📊 {sig["side"]} {pair.replace("USDT","")} bloqueado — 15m contra\n'
                    f'3m diz {sig["side"]} mas 15m está {"bearish" if sig["side"]=="BUY" else "bullish"}'
                )
                return

            if HFT_SKIP_CONFIRM:
                log.info(f'  ⚡ HFT DIRETO {sig["side"]} {pair} score={sig["score"]:.1f} conf={sig.get("confidence",0):.0%}')

                # ── Consulta IA antes de entrar ──────────────────────────────
                ai_result  = None
                tp_mult    = 1.0
                sl_mult    = 1.0
                entry_conf = sig.get('confidence', 0.5)
                entry_reason = f'[DIRECT] {sig["reason"]}'

                # ── Analytics: verifica score do par e horário ─────────
                if self.analytics:
                    hour_now = datetime.datetime.now().hour
                    can_enter, stake_mult_a, analytics_reason = self.analytics.should_enter(pair, sig['side'], hour_now)
                    if not can_enter:
                        log.info(f'  🚫 Analytics bloqueou {pair}: {analytics_reason}')
                        self.notify(f'🚫 Analytics bloqueou {sig["side"]} {pair.replace("USDT","")}\n{analytics_reason}')
                        return
                    if stake_mult_a < 1.0:
                        entry_conf = min(entry_conf, 0.4)  # reduz size em modo cautela
                        log.info(f'  ⚠️ Analytics CAUTELA {pair}: stake {stake_mult_a:.0%}')

                if self.ai_advisor and self.ai_advisor.enabled:
                    atr_now = self._atr(self.highs[pair], self.lows[pair], self.closes[pair])
                    if atr_now <= 0: atr_now = close * 0.002
                    sl_d = max(atr_now, close * HFT_SL_PCT / 100)
                    tp_d = max(atr_now * 2, sl_d * HFT_MIN_RR)
                    indicators_ctx = {
                        'rsi':      self._rsi(self.closes[pair]) if len(self.closes[pair]) >= 9 else 50,
                        'ema21':    self._ema(list(self.closes[pair])[-21:], 21) if len(self.closes[pair]) >= 21 else close,
                        'ema50':    self._ema(list(self.closes[pair])[-50:], 50) if len(self.closes[pair]) >= 50 else close,
                        'atr_pct':  atr_now / close * 100,
                        'vol_ratio': list(self.volumes[pair])[-1] / (sum(list(self.volumes[pair])[-6:-1])/5) if len(self.volumes[pair]) >= 6 else 1.0,
                        'bb_pct_b': (self._bollinger(self.closes[pair]) or (0,0,0,0.5,0))[3],
                        'macd_hist': self._macd_fast(self.closes[pair])[2],
                        'regime':   self._detect_regime(pair),
                        'adx':      self._adx(self.highs[pair], self.lows[pair], self.closes[pair]),
                    }
                    signal_ctx = {
                        'score': sig['score'], 'count': sig.get('count', 0),
                        'strategies': sig.get('strategies', []), 'reason': sig['reason'],
                        'confidence': entry_conf,
                        'tp_pct': tp_d/close*100, 'sl_pct': sl_d/close*100,
                    }
                    ai_result = self.ai_advisor.validate(
                        pair, sig['side'], close,
                        indicators_ctx, signal_ctx,
                        self.pair_stats.get(pair, {}),
                        self.learner.get_summary()
                    )

                    if ai_result and ai_result.get('source') not in ('fallback', 'disabled'):
                        ai_dec  = ai_result.get('decision', 'ENTER')
                        ai_conf = ai_result.get('confidence', 0.5)
                        ai_why  = ai_result.get('reason', '')
                        tp_mult = ai_result.get('tp_mult', 1.0)
                        sl_mult = ai_result.get('sl_mult', 1.0)
                        model   = ai_result.get('model_used', '?')

                        if ai_dec == 'SKIP':
                            self._ai_skipped += 1
                            self.notify(
                                f'🚫 IA bloqueou {sig["side"]} {pair.replace("USDT","")}\n'
                                f'Modelo: {model} | Conf IA: {ai_conf:.0%}\n'
                                f'Motivo: {ai_why}'
                            )
                            log.info(f'  🚫 IA BLOQUEOU {pair} {sig["side"]} | {ai_why}')
                            return  # sai sem entrar
                        elif ai_dec == 'REDUCE':
                            entry_conf = min(entry_conf, 0.4)
                            entry_reason = f'[IA:REDUCE {ai_conf:.0%}] {sig["reason"]}'
                            log.info(f'  ⚠️ IA REDUCE {pair} — {ai_why} | entrando com size reduzido')
                        else:
                            entry_reason = f'[IA:{ai_conf:.0%}] {sig["reason"]}'
                            log.info(f'  ✅ IA APROVOU {pair} {sig["side"]} conf={ai_conf:.0%} | {ai_why}')

                entered = self._open_position(
                    pair, sig['side'], close,
                    entry_reason,
                    sig.get('strategies', []),
                    entry_conf,
                    tp_mult=tp_mult, sl_mult=sl_mult
                )
                if not entered:
                    info = self._sym_info.get(pair, {})
                    budget = self.capital * HFT_RISK_PCT / 100
                    qty_est = budget / close if close > 0 else 0
                    self.notify(
                        f'⚠️ {sig["side"]} {pair.replace("USDT","")} gerado mas NÃO entrou\n'
                        f'Preço: ${close:,.4f} | Budget: ${budget:.2f}\n'
                        f'Qty estimada: {qty_est:.4f} | Min qty: {info.get("min_qty","?")}\n'
                        f'Step: {info.get("step","?")} | Min notional: ${info.get("min_notional","?")}\n'
                        f'Score: {sig["score"]:.1f} | Conf: {sig.get("confidence",0):.0%}'
                    )
            else:
                self._pending[pair] = sig
                self.send_signal_alert(
                    pair, sig['side'], sig['score'], sig.get('count', 0),
                    sig['reason'], sig.get('regime', '?'), sig.get('rsi', 50),
                    sig.get('confidence', 0.5), sig.get('price', close)
                )
        else:
            n = self._candle_count.get(pair, 0)
            log.info(f'  📊 HFT {pair} RSI={self._rsi(self.closes[pair]):.0f} | {sig["reason"]}')
            # A cada 10 velas sem sinal, manda resumo no Telegram com motivo
            if n > 0 and n % 10 == 0:
                rsi_v  = self._rsi(self.closes[pair]) if len(self.closes[pair]) >= 9 else 50
                regime = self._detect_regime(pair) if len(self.closes[pair]) >= 50 else '?'
                regime_icons = {'trending_up':'↗','trending_down':'↘','ranging':'↔','choppy':'〰'}
                r_icon = regime_icons.get(regime, '?')
                self.notify(
                    f'🔍 {pair.replace("USDT","")} sem sinal ({n} velas)\n'
                    f'RSI: {rsi_v:.0f} | {r_icon} {regime}\n'
                    f'Motivo: {sig["reason"]}'
                )

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
            'analytics': self.analytics.get_full_report() if self.analytics else None,
            'capital_current': round(self.capital, 4),
            'budget_per_trade': round(self.capital * HFT_RISK_PCT / 100, 4),
            'ai_approved':     self._ai_approved,
            'daily_breakevens': getattr(self, 'daily_breakevens', 0),
            'pnl_summary':     self.get_pnl_summary(),
            'daily_protect': {
                'enabled':  HFT_DAILY_PROTECT_ENABLED,
                'active':   self.daily_protect_active,
                'stopped':  self.daily_protect_stopped,
                'peak_pnl': round(self.peak_daily_pnl, 4),
                'floor':    round(self.daily_protect_floor, 4),
                'threshold': HFT_DAILY_PROTECT_THRESHOLD,
                'protect_pct': HFT_DAILY_PROTECT_PCT,
            },
            'dynamic_loss': {
                'enabled':      HFT_DYNAMIC_DAILY_LOSS,
                'limit':        round(self.dynamic_loss_limit, 4),
                'prev_profit':  round(self.prev_day_profit, 4),
                'current_pnl':  round(self.daily_pnl, 4),
                'remaining':    round(self.dynamic_loss_limit - abs(min(self.daily_pnl, 0)), 4),
            },
        }

    def send_heartbeat(self):
        """Heartbeat: prova que o bot está vivo e escaneando."""
        total = self.daily_wins + self.daily_losses + getattr(self, 'daily_breakevens', 0)
        pnl   = self.daily_pnl
        icon  = '🟢' if pnl > 0 else ('⚪' if abs(pnl) < 0.0001 else '🔴')
        open_pos = len(self.positions)
        pending_count = len(self._pending)

        # Busca saldo real da Binance para mostrar no heartbeat
        real_balance = self.capital
        try:
            if HFT_MARKET == 'futures':
                bals = self.client.futures_account_balance()
                usdt = next((float(b['balance']) for b in bals if b['asset']=='USDT'), None)
                if usdt: real_balance = usdt
            else:
                acc = self.client.get_account()
                for a in acc.get('balances',[]):
                    if a['asset']=='USDT':
                        real_balance = float(a['free']); break
        except: pass

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
            # Amplitude indicator
            atr_v   = self._atr(self.highs.get(pair,[]), self.lows.get(pair,[]), self.closes.get(pair,[]))
            atr_p   = atr_v / list(self.closes.get(pair,[1]))[-1] * 100 if self.closes.get(pair) else 0
            amp_str = f' ATR:{atr_p:.2f}%' if atr_p > 0 else ''
            # Analytics status
            if self.analytics:
                an_s = self.analytics.get_pair_status(pair)
                an_str = f' [{an_s["status"][:4]}]' if an_s.get('score') else ''
            else:
                an_str = ''
            pair_lines.append(f'  {pair.replace("USDT",""):6} RSI:{rsi_v:.0f} {r_icon} {regime}{amp_str}{an_str}{pending}{pos_str}')

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

        # Daily Profit Protector status
        protect_str = ''
        if HFT_DAILY_PROTECT_ENABLED:
            if self.daily_protect_stopped:
                protect_str = f'\n🛡 <b>Lucro protegido — parado no dia</b> (piso: ${self.daily_protect_floor:.4f})'
            elif self.daily_protect_active:
                protect_str = f'\n🛡 Proteção ativa: pico ${self.peak_daily_pnl:.4f} | piso ${self.daily_protect_floor:.4f}'
        # Dynamic daily loss info
        if HFT_DYNAMIC_DAILY_LOSS:
            src = f'lucro anterior' if self.prev_day_profit > 0 else f'fallback {HFT_DAILY_LOSS_FALLBACK_PCT}%'
            protect_str += f'\n📊 Loss máx hoje: ${self.dynamic_loss_limit:.2f} ({src})'

        bal_diff = real_balance - self.capital
        bal_str  = f'${real_balance:.2f}'
        if abs(bal_diff) > 0.01: bal_str += f' ({bal_diff:+.2f} vs base)'
        self.notify(
            f'💓 <b>HFT Heartbeat — Bot ativo</b>\n'
            f'─────────────────────────\n'
            f'⚡ Monitorando <b>{len(HFT_PAIRS)}</b> pares em {HFT_TIMEFRAME}\n'
            f'💰 Saldo real: <code>{bal_str}</code> | Budget/trade: <code>${budget:.2f}</code>\n'
            f'{icon} Hoje: <code>{"+$" if pnl>=0 else "-$"}{abs(pnl):.4f}</code> | {total}T WR:{(self.daily_wins/max(self.daily_wins+self.daily_losses,1)*100):.0f}%\n'
            f'─────────────────────────\n'
            f'<b>Status dos pares:</b>\n' + '\n'.join(pair_lines) +
            f'\n{status_str}{pending_str}{protect_str}\n'
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

        # ── Projeção de lucro baseada em dados REAIS ─────────────────────────
        risk_pct  = float(os.environ.get('HFT_RISK_PCT', HFT_RISK_PCT))
        tp_pct    = HFT_TP_PCT
        sl_pct    = HFT_SL_PCT
        capital   = self.capital
        leverage  = HFT_LEVERAGE
        fee_rate  = HFT_FEE_RATE
        budget    = capital * risk_pct / 100
        position  = budget * leverage
        fee_rt    = position * fee_rate * 2  # taxa real round-trip
        # Lucro/perda LÍQUIDOS reais (após taxa)
        per_win   = position * tp_pct / 100 - fee_rt
        per_loss  = position * sl_pct / 100 + fee_rt
        wins_real = self.daily_wins
        loss_real = self.daily_losses
        # PnL real do dia (o que realmente aconteceu)
        res_real  = self.daily_pnl
        roi_day   = res_real / capital * 100 if capital > 0 else 0
        # Projeção mensal: usa PnL médio por trade real × trades estimados por dia
        avg_trade = res_real / total if total > 0 else 0
        trades_per_day = 8  # estimativa 3m timeframe
        proj_day  = avg_trade * trades_per_day
        proj_mo   = proj_day * 22
        roi_mo    = proj_mo / capital * 100 if capital > 0 else 0
        avg_day   = res_real  # mantém compatibilidade
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

        # ── Salva lucro do dia como loss limit de amanhã ──────────────────
        if self.daily_pnl > 0:
            self._save_prev_day_profit(self.daily_pnl)
            self.prev_day_profit = self.daily_pnl
            log.info(f'  📊 Lucro do dia ${self.daily_pnl:.4f} salvo → loss limit amanhã')
        else:
            # Dia de loss: mantém o limit anterior (não piora)
            log.info(f'  📊 Dia sem lucro (${self.daily_pnl:.4f}) — mantém loss limit anterior ${self.prev_day_profit:.4f}')

        # Recalcula loss limit para amanhã
        self.dynamic_loss_limit = self._calc_dynamic_loss_limit()

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
        # Reset Daily Profit Protector
        self.peak_daily_pnl = 0.0; self.daily_protect_active = False
        self.daily_protect_floor = 0.0; self.daily_protect_stopped = False
        self.pair_stats   = {p: {'wins': 0, 'losses': 0, 'pnl': 0.0} for p in HFT_PAIRS}
        self._ai_skipped  = 0
        self._ai_approved = 0
        self.daily_breakevens = 0
        self.strategy_stats = {s: {'wins': 0, 'losses': 0} for s in STRATEGY_NAMES}
        self.running = True
        # Recarrega calibração (pode ter sido atualizada overnight)
        self._load_calibration()
        # Mostra resumo do aprendizado da IA no reset diário
        try:
            ls = self.learner.get_summary()
            top = sorted([(s,d) for s,d in ls.items() if isinstance(d,dict) and d.get('n',0)>=5],
                         key=lambda x: float(x[1].get('wr',0)) if x[1].get('wr')!='N/A' else 0, reverse=True)[:3]
            bot3 = sorted([(s,d) for s,d in ls.items() if isinstance(d,dict) and d.get('n',0)>=5],
                          key=lambda x: float(x[1].get('wr',0)) if x[1].get('wr')!='N/A' else 0)[:2]
            if top:
                top_str = ' | '.join(f'{s}:{d["wr"]}%' for s,d in top)
                bot_str = ' | '.join(f'{s}:{d["wr"]}%' for s,d in bot3)
                self.notify(
                    f'🧠 <b>Aprendizado IA — resumo do dia</b>\n'
                    f'✅ Melhores estratégias: {top_str}\n'
                    f'❌ Piores: {bot_str}\n'
                    f'💡 Pesos ajustados para amanhã automaticamente'
                )
        except: pass
        log.info('  ✅ HFT v3.1 novo dia iniciado')


# ── Singleton ─────────────────────────────────────────────────────────────────
_hft_engine = None
_visibility_active = False   # flag independente de engine.running


def get_hft_engine(): return _hft_engine


def _start_visibility_thread(engine):
    """
    Thread de visibilidade autônoma — heartbeat + update periódico.
    Usa _visibility_active (flag própria) em vez de engine.running,
    para continuar funcionando mesmo quando o engine pausa por daily-loss.
    """
    global _visibility_active
    if _visibility_active:
        log.debug('  Visibility thread já ativa — ignorando chamada duplicada')
        return
    _visibility_active = True

    UPDATE_INTERVAL = int(os.environ.get('HFT_UPDATE_INTERVAL', '1800'))

    def _loop():
        global _visibility_active
        _last_heartbeat = 0.0
        _last_update    = time.time()
        _last_weekly    = time.time()
        _first_hb_sent  = False
        try:
            while _visibility_active:
                time.sleep(30)
                if not _visibility_active:
                    break
                now = time.time()

                # ── Heartbeat ────────────────────────────────────────────
                hb_sec = HFT_HEARTBEAT_SEC
                if hb_sec > 0:
                    delay = 30 if not _first_hb_sent else hb_sec
                    if now >= _last_heartbeat + delay:
                        try:
                            engine.send_heartbeat()
                            _last_heartbeat = now
                            _first_hb_sent  = True
                        except Exception as _e:
                            log.debug(f'  Heartbeat erro: {_e}')

                # ── Update periódico — só se houver trades ───────────────
                total = engine.daily_wins + engine.daily_losses + getattr(engine, 'daily_breakevens', 0)
                if total > 0 and now - _last_update >= UPDATE_INTERVAL:
                    try:
                        mins  = UPDATE_INTERVAL // 60
                        label = f'{mins}min' if mins < 60 else f'{mins // 60}h'
                        engine.send_periodic_update(label)
                        _last_update = now
                    except Exception as _pe:
                        log.debug(f'  Periodic update erro: {_pe}')

                # ── MELHORIA 7: Resumo semanal (domingo 23:50 local) ─────
                try:
                    h_local = (datetime.datetime.utcnow().hour + HFT_TZ_OFFSET) % 24
                    weekday = datetime.datetime.utcnow().weekday()  # 6 = domingo
                    if weekday == 6 and h_local == 23 and now - _last_weekly > 82800:  # ~23h gap
                        engine.send_weekly_summary()
                        _last_weekly = now
                except Exception:
                    pass
        finally:
            _visibility_active = False

    t = threading.Thread(target=_loop, daemon=True, name='HFT-Visibility')
    t.start()
    log.info('  💓 HFT Visibility thread iniciada (heartbeat a cada %ds)', HFT_HEARTBEAT_SEC)


def init_hft(capital, client, notify_fn=None):
    global _hft_engine
    _hft_engine = HFTEngine(capital, client, notify_fn)
    _hft_engine.running = True
    _start_visibility_thread(_hft_engine)
    return _hft_engine
