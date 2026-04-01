"""
CryptoEdge Pro — HFT Auto-Calibrator v1.0
==========================================
Roda backtest em dados reais para encontrar os parâmetros ótimos
por par antes de o bot começar a operar.

Calibra:
  - rsi_buy_threshold    (25–38): quão oversold precisa ser para comprar
  - rsi_sell_threshold   (62–75): quão overbought precisa ser para vender
  - min_score            (2.4–4.0): score mínimo ponderado para entrar
  - vol_multiplier       (1.3–2.0): spike de volume mínimo
  - min_signals          (2–4): quantidade mínima de estratégias concordando

Salva resultado em /data/hft_calibration.json.
O HFTEngine carrega esses parâmetros automaticamente no startup.
"""

import os, time, logging, json as _json
from collections import deque

log = logging.getLogger('CryptoEdge.Calibrator')

def _data_dir():
    d = os.environ.get('BOT_DATA_DIR', '')
    if d: return d
    if os.path.isdir('/data'): return '/data'
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(local, exist_ok=True)
    return local

_CALIB_FILE  = os.environ.get('HFT_CALIB_FILE', os.path.join(_data_dir(), 'hft_calibration.json'))
_CALIB_HOURS = float(os.environ.get('HFT_CALIB_HOURS', '24'))   # re-calibra a cada N horas
_CALIB_DAYS  = int(os.environ.get('HFT_CALIB_DAYS', '5'))       # dias de histórico para backtest

# ── Indicadores (standalone, sem dependências externas) ───────────────────────

def _ema(vals, p):
    v = list(vals)
    if not v: return 0
    k = 2 / (p + 1); e = v[0]
    for x in v[1:]: e = x * k + e * (1 - k)
    return e

def _rsi(closes, period=7):
    v = list(closes)[-(period + 2):]
    if len(v) < period + 1: return 50
    g = [max(v[i] - v[i-1], 0) for i in range(1, len(v))]
    l = [max(v[i-1] - v[i], 0) for i in range(1, len(v))]
    ag = sum(g) / len(g); al = sum(l) / len(l)
    return 100 if al == 0 else 100 - (100 / (1 + ag / al))

def _bollinger(closes, period=14, std=2.0):
    v = list(closes)[-period:]
    if len(v) < period: return None
    mid = sum(v) / len(v)
    sd  = (sum((x - mid)**2 for x in v) / len(v))**0.5
    upper = mid + std * sd; lower = mid - std * sd
    pct_b = (v[-1] - lower) / (upper - lower) if upper != lower else 0.5
    bw    = (upper - lower) / mid * 100 if mid else 0
    return upper, mid, lower, pct_b, bw

def _vwap(closes, volumes, period=20):
    c = list(closes)[-period:]; v = list(volumes)[-period:]
    if not c or not v: return c[-1] if c else 0
    tv = sum(v)
    return sum(ci * vi for ci, vi in zip(c, v)) / tv if tv > 0 else c[-1]

def _stochastic(closes, highs, lows, k_period=9):
    c = list(closes)[-k_period:]; h = list(highs)[-k_period:]; l = list(lows)[-k_period:]
    if len(c) < k_period: return 50
    ll = min(l); hh = max(h)
    return (c[-1] - ll) / (hh - ll) * 100 if hh != ll else 50

def _cci(closes, highs, lows, period=14):
    c = list(closes)[-period:]; h = list(highs)[-period:]; l = list(lows)[-period:]
    if len(c) < period: return 0
    tp   = [(h[i] + l[i] + c[i]) / 3 for i in range(len(c))]
    m    = sum(tp) / len(tp)
    md   = sum(abs(x - m) for x in tp) / len(tp)
    return (tp[-1] - m) / (0.015 * md) if md else 0

def _macd_fast(closes):
    v = list(closes)
    if len(v) < 15: return 0
    ef = _ema(v[-3:], 3); es = _ema(v[-10:], 10)
    ml = ef - es
    ms = []
    for i in range(max(0, len(v) - 10), len(v)):
        ms.append(_ema(v[max(0, i-3):i+1], 3) - _ema(v[max(0, i-10):i+1], 10))
    sl = _ema(ms[-5:], 5) if len(ms) >= 5 else ml
    return ml - sl  # histogram

def _atr(highs, lows, closes, period=7):
    h = list(highs)[-(period+1):]; l = list(lows)[-(period+1):]; c = list(closes)[-(period+1):]
    if len(c) < 2: return 0
    trs = [max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])) for i in range(1, len(c))]
    return sum(trs) / len(trs) if trs else 0

def _adx(highs, lows, closes, period=14):
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
    return 100 * abs(pdi - ndi) / (pdi + ndi) if (pdi + ndi) > 0 else 0

def _price_action(opens, closes, highs, lows):
    o = list(opens); c = list(closes); h = list(highs); l = list(lows)
    if len(c) < 2: return None
    body = abs(c[-1] - o[-1]); rng = h[-1] - l[-1]
    if rng > 0:
        uw = h[-1] - max(c[-1], o[-1])
        lw = min(c[-1], o[-1]) - l[-1]
        if lw > body * 2 and lw > uw * 2: return 'BUY'
        if uw > body * 2 and uw > lw * 2: return 'SELL'
    pb = abs(c[-2] - o[-2])
    if body > pb * 1.5:
        if c[-1] > o[-1] and c[-2] < o[-2]: return 'BUY'
        if c[-1] < o[-1] and c[-2] > o[-2]: return 'SELL'
    return None

# ── Mini backtester HFT (replica a lógica do engine com parâmetros variáveis) ─

def _run_backtest(klines, params):
    """
    Executa backtest completo com os parâmetros dados.
    Retorna: {'trades', 'win_rate', 'profit_factor', 'sharpe', 'roi', 'avg_trade_min'}
    """
    rsi_buy   = params['rsi_buy']
    rsi_sell  = params['rsi_sell']
    min_score = params['min_score']
    vol_mult  = params['vol_mult']
    min_sig   = params['min_signals']
    min_rr    = params.get('min_rr', 1.5)

    WINDOW = 250
    closes  = deque(maxlen=WINDOW); highs   = deque(maxlen=WINDOW)
    lows    = deque(maxlen=WINDOW); volumes = deque(maxlen=WINDOW)
    opens   = deque(maxlen=WINDOW)

    capital  = 1000.0
    position = None
    trades   = []
    pnls     = []

    WARMUP = 60
    pending = None  # sinal pendente aguardando confirmação

    for i, k in enumerate(klines):
        o = float(k[1]); h = float(k[2]); l = float(k[3])
        c = float(k[4]); v = float(k[5]); ts = int(k[0])

        closes.append(c); highs.append(h); lows.append(l)
        volumes.append(v); opens.append(o)

        if i < WARMUP: continue

        # ── Verificar SL/TP de posição aberta ────────────────────────────
        if position:
            side  = position['side']
            sl    = position['sl']; tp = position['tp']
            entry = position['entry']
            age_min = (ts - position['ts']) / 60000

            hit = False
            if side == 'BUY':
                if l <= sl:
                    pnl = (sl - entry) * position['qty']; capital += pnl
                    trades.append({'win': pnl > 0, 'pnl': pnl, 'dur': age_min, 'reason': 'SL'})
                    pnls.append(pnl); position = None; hit = True
                elif h >= tp:
                    pnl = (tp - entry) * position['qty']; capital += pnl
                    trades.append({'win': pnl > 0, 'pnl': pnl, 'dur': age_min, 'reason': 'TP'})
                    pnls.append(pnl); position = None; hit = True
                elif age_min > 16 and c > entry:  # time-exit profitable
                    pnl = (c - entry) * position['qty']; capital += pnl
                    trades.append({'win': pnl > 0, 'pnl': pnl, 'dur': age_min, 'reason': 'TIME_P'})
                    pnls.append(pnl); position = None; hit = True
                elif age_min > 32:
                    pnl = (c - entry) * position['qty']; capital += pnl
                    trades.append({'win': pnl > 0, 'pnl': pnl, 'dur': age_min, 'reason': 'TIME_X'})
                    pnls.append(pnl); position = None; hit = True
            else:
                if h >= sl:
                    pnl = (entry - sl) * position['qty']; capital += pnl
                    trades.append({'win': pnl > 0, 'pnl': pnl, 'dur': age_min, 'reason': 'SL'})
                    pnls.append(pnl); position = None; hit = True
                elif l <= tp:
                    pnl = (entry - tp) * position['qty']; capital += pnl
                    trades.append({'win': pnl > 0, 'pnl': pnl, 'dur': age_min, 'reason': 'TP'})
                    pnls.append(pnl); position = None; hit = True
                elif age_min > 16 and c < entry:
                    pnl = (entry - c) * position['qty']; capital += pnl
                    trades.append({'win': pnl > 0, 'pnl': pnl, 'dur': age_min, 'reason': 'TIME_P'})
                    pnls.append(pnl); position = None; hit = True
                elif age_min > 32:
                    pnl = (entry - c) * position['qty']; capital += pnl
                    trades.append({'win': pnl > 0, 'pnl': pnl, 'dur': age_min, 'reason': 'TIME_X'})
                    pnls.append(pnl); position = None; hit = True

        if position: continue  # ainda em posição

        # ── Detectar regime ───────────────────────────────────────────────
        if len(closes) >= 50:
            adx_v = _adx(highs, lows, closes)
            ema21 = _ema(list(closes)[-21:], 21)
            ema50 = _ema(list(closes)[-50:], 50)
            bb    = _bollinger(closes, period=20)
            bw    = bb[4] if bb else 1.0
            if bw < 0.05: continue  # choppy — alinhado com hft_strategy.py
        else:
            adx_v = 0; ema50 = c; ema21 = c

        # Filtro macro
        macro_bull = c > ema50 * 1.001
        macro_bear = c < ema50 * 0.999

        # ── Gerar sinal (replica engine v3) ──────────────────────────────
        buy_score = 0.0; sell_score = 0.0
        buy_count = 0;   sell_count = 0

        # 1. EMA Micro
        e3 = _ema(list(closes)[-3:], 3); e8 = _ema(list(closes)[-8:], 8); e21 = ema21
        if e3 > e8 * 1.0001 and e8 > e21 * 0.9998:
            buy_score += 1.0 * (1.2 if macro_bull else 0.6 if macro_bear else 1.0); buy_count += 1
        elif e3 < e8 * 0.9999 and e8 < e21 * 1.0002:
            sell_score += 1.0 * (1.2 if macro_bear else 0.6 if macro_bull else 1.0); sell_count += 1

        # 2. RSI
        rsi_v = _rsi(closes)
        if rsi_v < rsi_buy:
            w = 1.8 if rsi_v < (rsi_buy - 8) else 0.9
            buy_score += w; buy_count += 1
        elif rsi_v > rsi_sell:
            w = 1.8 if rsi_v > (rsi_sell + 8) else 0.9
            sell_score += w; sell_count += 1

        # 3. Bollinger
        bb = _bollinger(closes)
        if bb:
            _, _, _, pct_b, bw_v = bb
            if bw_v > 0.12:
                if pct_b < 0.06:   buy_score  += 1.4; buy_count  += 1
                elif pct_b < 0.18: buy_score  += 0.8; buy_count  += 1
                elif pct_b > 0.94: sell_score += 1.4; sell_count += 1
                elif pct_b > 0.82: sell_score += 0.8; sell_count += 1

        # 4. VWAP
        vw  = _vwap(closes, volumes)
        dev = (c - vw) / vw * 100 if vw else 0
        if dev < -0.35:   buy_score  += 1.3; buy_count  += 1
        elif dev < -0.18: buy_score  += 0.7; buy_count  += 1
        elif dev > 0.35:  sell_score += 1.3; sell_count += 1
        elif dev > 0.18:  sell_score += 0.7; sell_count += 1

        # 5. Volume Momentum
        vls = list(volumes)
        if len(vls) >= 6:
            avg_v = sum(vls[-6:-1]) / 5
            if avg_v > 0 and v > avg_v * vol_mult:
                cls = list(closes)
                if cls[-1] > cls[-2] * 1.0008:   buy_score  += 1.5; buy_count  += 1
                elif cls[-1] < cls[-2] * 0.9992:  sell_score += 1.5; sell_count += 1

        # 6. Stochastic
        if len(closes) >= 12:
            sk = _stochastic(closes, highs, lows)
            if sk < 22:   buy_score  += 1.2; buy_count  += 1
            elif sk > 78: sell_score += 1.2; sell_count += 1

        # 7. CCI
        if len(closes) >= 14:
            cci_v = _cci(closes, highs, lows)
            if cci_v < -90:  buy_score  += 1.1; buy_count  += 1
            elif cci_v > 90: sell_score += 1.1; sell_count += 1

        # 8. MACD Fast
        if len(closes) >= 15:
            mh = _macd_fast(closes)
            ml = abs(_ema(list(closes)[-3:], 3) - _ema(list(closes)[-10:], 10))
            if mh > 0 and mh > ml * 0.12:   buy_score  += 1.0; buy_count  += 1
            elif mh < 0 and abs(mh) > ml * 0.12: sell_score += 1.0; sell_count += 1

        # 9. Price Action
        if len(opens) >= 2:
            pa = _price_action(opens, closes, highs, lows)
            if pa == 'BUY':   buy_score  += 1.5; buy_count  += 1
            elif pa == 'SELL': sell_score += 1.5; sell_count += 1

        # Divergência
        tot = buy_score + sell_score
        if tot > 0 and 0.35 < buy_score / tot < 0.65: continue

        # Decisão
        side = None
        if buy_count >= min_sig and buy_score >= min_score and buy_score > sell_score * 1.4:
            side = 'BUY'
        elif sell_count >= min_sig and sell_score >= min_score and sell_score > buy_score * 1.4:
            side = 'SELL'

        if not side:
            pending = None  # sinal contrariado — descarta pendente
            continue

        # ── Filtro de confirmação: armazena sinal, entra na vela seguinte ─
        risk_pct_env = float(os.environ.get('HFT_RISK_PCT', '1.5')) / 100
        max_drift    = float(os.environ.get('HFT_CONFIRM_MAX_DRIFT', '0.25'))
        if pending and pending['side'] == side:
            drift     = abs(c - pending['price']) / pending['price'] * 100
            bullish   = c > o * 1.0001
            bearish   = c < o * 0.9999
            confirmed = (side == 'BUY' and bullish) or (side == 'SELL' and bearish)
            if confirmed and drift <= max_drift:
                # ── Abrir posição confirmada ──────────────────────────────
                atr_v = _atr(highs, lows, closes)
                if atr_v <= 0: atr_v = c * 0.002
                sl_dist = max(atr_v * 1.0, c * 0.0020)
                tp_dist = max(atr_v * 2.0, sl_dist * min_rr)
                rr      = tp_dist / sl_dist if sl_dist > 0 else 0
                if rr >= min_rr:
                    qty = capital * risk_pct_env / c
                    if side == 'BUY':
                        position = {'side': 'BUY',  'entry': c, 'qty': qty,
                                    'sl': c - sl_dist, 'tp': c + tp_dist, 'ts': ts}
                    else:
                        position = {'side': 'SELL', 'entry': c, 'qty': qty,
                                    'sl': c + sl_dist, 'tp': c - tp_dist, 'ts': ts}
            pending = None
        else:
            pending = {'side': side, 'price': c}  # armazena para confirmar na vela seguinte

    # ── Métricas ──────────────────────────────────────────────────────────────
    n    = len(trades)
    if n < 5:
        return {'trades': n, 'win_rate': 0, 'profit_factor': 0,
                'sharpe': -99, 'roi': 0, 'avg_dur': 0}

    wins   = [t for t in trades if t['win']]
    losses = [t for t in trades if not t['win']]
    wr     = len(wins) / n * 100
    gross_p = sum(t['pnl'] for t in wins) if wins else 0
    gross_l = abs(sum(t['pnl'] for t in losses)) if losses else 0
    pf      = gross_p / gross_l if gross_l > 0 else (99.0 if gross_p > 0 else 0.0)
    roi     = (capital - 1000.0) / 1000.0 * 100 if capital != 0 else 0
    avg_dur = sum(t['dur'] for t in trades) / n if n > 0 else 0

    # Sharpe simplificado
    if len(pnls) > 1:
        mu  = sum(pnls) / len(pnls)
        var = sum((p - mu)**2 for p in pnls) / len(pnls)
        std = var**0.5 if var > 0 else 1e-9
        sharpe = (mu / std) * (252**0.5)
    else:
        sharpe = 0.0

    return {
        'trades':        n,
        'win_rate':      round(wr, 1),
        'profit_factor': round(pf, 2),
        'sharpe':        round(sharpe, 2),
        'roi':           round(roi, 2),
        'avg_dur':       round(avg_dur, 1),
    }

# ── Calibração por par ────────────────────────────────────────────────────────

def _score_result(r):
    """Pontuação composta para escolher o melhor conjunto de parâmetros."""
    if r['trades'] < 8: return -99
    wr  = r['win_rate']
    pf  = min(r['profit_factor'], 5.0)
    roi = r['roi']
    sh  = min(max(r['sharpe'], -3), 5)
    # Win rate acima de 50% tem bônus exponencial
    wr_bonus = max(0, (wr - 50) ** 1.5) * 0.05
    return sh * 0.35 + (pf - 1) * 0.30 + roi * 0.20 + wr_bonus * 0.15

def calibrate_pair(klines, pair):
    """
    Grid search sobre os parâmetros principais.
    Retorna o melhor conjunto + métricas.
    """
    # Grid de parâmetros a testar
    grid = []
    for rsi_b in [25, 28, 32, 36]:
        for rsi_s in [64, 68, 72, 75]:
            for min_sc in [2.6, 3.0, 3.4, 3.8]:
                for vol_m in [1.4, 1.6, 1.9]:
                    for min_sg in [2, 3]:
                        grid.append({
                            'rsi_buy':    rsi_b,
                            'rsi_sell':   rsi_s,
                            'min_score':  min_sc,
                            'vol_mult':   vol_m,
                            'min_signals': min_sg,
                            'min_rr': float(os.environ.get('HFT_MIN_RR', '1.4')),
                        })

    best_score  = -999
    best_params = None
    best_result = None

    for params in grid:
        try:
            r = _run_backtest(klines, params)
            s = _score_result(r)
            if s > best_score:
                best_score  = s
                best_params = params.copy()
                best_result = r
        except Exception:
            continue

    if best_params is None:
        # Fallback: parâmetros padrão
        best_params = {
            'rsi_buy': 28, 'rsi_sell': 72,
            'min_score': 3.0, 'vol_mult': 1.5,
            'min_signals': 3, 'min_rr': float(os.environ.get('HFT_MIN_RR', '1.4')),
        }
        best_result = {'trades': 0, 'win_rate': 0, 'profit_factor': 0,
                       'sharpe': 0, 'roi': 0}

    return {
        'pair':         pair,
        'params':       best_params,
        'backtest':     best_result,
        'score':        round(best_score, 3),
        'calibrated_at': time.time(),
    }

# ── Calibração completa (todos os pares) ──────────────────────────────────────

def run_calibration(client, pairs, timeframe='1m', days=None):
    """
    Baixa dados históricos e calibra todos os pares.
    Salva resultado em _CALIB_FILE e retorna o dicionário.
    """
    if days is None:
        days = _CALIB_DAYS

    limit   = min(days * 1440, 1000)  # max 1000 candles por request da Binance
    results = {}

    log.info(f'  🔬 Calibração HFT iniciada | {len(pairs)} pares | {limit} velas cada')
    t0 = time.time()

    for pair in pairs:
        try:
            log.info(f'    Calibrando {pair}...')
            klines = client.get_klines(symbol=pair, interval=timeframe, limit=limit)
            if len(klines) < 120:
                log.warning(f'    {pair}: dados insuficientes ({len(klines)} velas)')
                continue
            result = calibrate_pair(klines, pair)
            results[pair] = result
            bt = result['backtest']
            log.info(
                f'    {pair} OK | WR:{bt["win_rate"]}% PF:{bt["profit_factor"]} '
                f'Trades:{bt["trades"]} ROI:{bt["roi"]}% | '
                f'rsi_b={result["params"]["rsi_buy"]} rsi_s={result["params"]["rsi_sell"]} '
                f'score>={result["params"]["min_score"]} sig>={result["params"]["min_signals"]}'
            )
        except Exception as e:
            log.warning(f'    {pair}: erro na calibração: {e}')

    elapsed = time.time() - t0
    log.info(f'  Calibração concluída em {elapsed:.1f}s | {len(results)}/{len(pairs)} pares calibrados')

    # Salva
    payload = {
        'pairs':       results,
        'calibrated_at': time.time(),
        'timeframe':   timeframe,
        'limit':       limit,
    }
    try:
        os.makedirs(os.path.dirname(_CALIB_FILE), exist_ok=True)
        with open(_CALIB_FILE, 'w') as f:
            _json.dump(payload, f)
        log.info(f'  Calibração salva em {_CALIB_FILE}')
    except Exception as e:
        log.warning(f'  Falha ao salvar calibração: {e}')

    return payload

def load_calibration():
    """Carrega calibração salva. Retorna None se não existe ou expirada."""
    try:
        if not os.path.exists(_CALIB_FILE):
            return None
        with open(_CALIB_FILE) as f:
            data = _json.load(f)
        age_hours = (time.time() - data.get('calibrated_at', 0)) / 3600
        if age_hours > _CALIB_HOURS:
            log.info(f'  Calibração expirada ({age_hours:.1f}h > {_CALIB_HOURS}h) — recalibrando')
            return None
        log.info(f'  Calibração carregada ({age_hours:.1f}h atrás) | {len(data.get("pairs", {}))} pares')
        return data
    except Exception:
        return None

def get_pair_params(pair, fallback=None):
    """
    Retorna os parâmetros calibrados para um par específico.
    Se não houver, retorna fallback ou parâmetros padrão.
    """
    default = {
        'rsi_buy': 28, 'rsi_sell': 72,
        'min_score': 3.0, 'vol_mult': 1.5,
        'min_signals': 3, 'min_rr': 1.5,
    }
    if fallback:
        default.update(fallback)
    try:
        data = load_calibration()
        if data and pair in data.get('pairs', {}):
            return data['pairs'][pair].get('params', default)
    except Exception:
        pass
    return default

def needs_calibration():
    """Verifica se é necessário rodar calibração."""
    data = load_calibration()
    return data is None
