#!/usr/bin/env python3
"""
CryptoEdge Pro — Bot v4.0 (Pattern Engine)
Opera vela a vela identificando padrões históricos e prevendo o próximo movimento.
"""

import os, time, json, logging, signal, sys, math, threading
from hft_strategy import (init_hft, get_hft_engine, HFT_PAIRS, HFT_TIMEFRAME,
    HFT_TP_PCT, HFT_SL_PCT, HFT_RISK_PCT, HFT_COOLDOWN, HFT_DAILY_LOSS, HFT_MIN_SIGNALS)
from decimal import Decimal
from collections import deque
from binance.client import Client
from binance.enums import *
# python-binance v1+ uses REST polling — no BinanceSocketManager needed
from dotenv import load_dotenv
from patterns import Candle, PatternResult, Signal, run_all
from telegram_notify import (notify_start, notify_entry, notify_exit, notify_stop,
                              notify_session_target,
                              notify_stop_loss_global, notify_error, notify_signal,
                              request_entry_confirmation_v2)
import multi_scanner
# --- Live State Notifier -------------------------------------------------------
# Envia eventos ao servidor Node para atualizar o Live Trading em tempo real
_APP_URL  = os.environ.get('APP_URL', 'http://localhost:' + os.environ.get('PORT','3000'))
_BOT_TOKEN = os.environ.get('BOT_WEBHOOK_TOKEN', '')

def _live_event(etype, data=None):
    """Notifica o servidor Node de eventos do bot (posição, sinal, candle)."""
    try:
        import urllib.request, json as _json
        payload = _json.dumps({'type': etype, 'data': data or {}}).encode()
        req = urllib.request.Request(
            f'{_APP_URL}/api/live/event',
            data=payload,
            headers={'Content-Type': 'application/json',
                     'X-Bot-Token': _BOT_TOKEN},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # Não fatal — bot continua mesmo se servidor não responder

_open_trade_id = None

def _save_trade_open(side, sym, entry, qty, sl, tp, strat=''):
    global _open_trade_id
    try:
        import urllib.request, json as _j
        p = _j.dumps({'symbol':sym,'side':side,'entry':entry,'qty':qty,'sl':sl,'tp':tp,'strategy':strat}).encode()
        req = urllib.request.Request(f'{_APP_URL}/api/bot/trade/open', data=p,
            headers={'Content-Type':'application/json','X-Bot-Internal':'cryptoedge-bot-2024'}, method='POST')
        _open_trade_id = _j.loads(urllib.request.urlopen(req, timeout=3).read()).get('id')
    except Exception as e:
        log.debug(f'  save_trade_open: {e}')

def _save_trade_close(exit_p, pnl, reason=''):
    global _open_trade_id
    if not _open_trade_id: return
    try:
        import urllib.request, json as _j
        p = _j.dumps({'id':_open_trade_id,'exit_price':exit_p,'pnl':pnl,'reason':reason}).encode()
        req = urllib.request.Request(f'{_APP_URL}/api/bot/trade/close', data=p,
            headers={'Content-Type':'application/json','X-Bot-Internal':'cryptoedge-bot-2024'}, method='POST')
        urllib.request.urlopen(req, timeout=3)
        _open_trade_id = None
    except Exception as e:
        log.debug(f'  save_trade_close: {e}')




load_dotenv()
load_dotenv('.bot.env', override=True)  # frontend config takes priority
# Normalize symbol after loading .bot.env
SYMBOL = os.environ.get('BOT_SYMBOL', os.environ.get('SYMBOL', 'BTCUSDT')).upper().replace('/','').replace('-','')

# Timezone-aware logging
import os as _os
_TZ_OFFSET = int(_os.environ.get('BOT_TZ_OFFSET', '-3'))
_TZ = __import__('datetime').timezone(__import__('datetime').timedelta(hours=_TZ_OFFSET))
logging.Formatter.converter = lambda *args: __import__('datetime').datetime.now(_TZ).timetuple()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('gridbot.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger('CryptoEdge')

# -- Config ---------------------------------------------------------------------
API_KEY    = os.environ.get('BINANCE_API_KEY',   '')
SECRET_KEY = os.environ.get('BINANCE_SECRET_KEY','')
TESTNET    = os.environ.get('BOT_TESTNET','true').lower() == 'true'

SYMBOL     = os.environ.get('BOT_SYMBOL', os.environ.get('SYMBOL', 'BTCUSDT')).upper().replace('/','').replace('-','')
CAPITAL    = float(os.environ.get('BOT_CAPITAL',    '300'))
STOP_LOSS     = float(os.environ.get('BOT_STOP_LOSS',   '0'))
SESSION_GAIN  = float(os.environ.get('BOT_SESSION_GAIN','0'))  # para ao atingir gain
SESSION_LOSS  = float(os.environ.get('BOT_SESSION_LOSS','0'))  # para ao atingir loss
TIMEFRAME  = os.environ.get('BOT_TIMEFRAME', '15m')
STRATEGY   = os.environ.get('BOT_STRATEGY', 'pattern')
TRADE_MODE = os.environ.get('BOT_TRADE_MODE', 'manual')  # 'manual' ou 'auto'

# HFT — ativado automaticamente quando STRATEGY=hft
HFT_MODE = (os.environ.get('BOT_STRATEGY', 'pattern').lower() == 'hft')

# Multi-par scanner
SCAN_ENABLED  = os.environ.get('BOT_SCAN_ENABLED', 'true').lower() == 'true'
SCAN_PAIRS_RAW = os.environ.get('BOT_SCAN_PAIRS', '')   # CSV ex: 'BTCUSDT,ETHUSDT,SOLUSDT'
SCAN_INTERVAL  = int(os.environ.get('BOT_SCAN_INTERVAL', '300'))  # segundos entre scans
SCAN_MIN_CONF  = float(os.environ.get('BOT_SCAN_MIN_CONF', '0.68'))  # confiança mínima

# Pattern engine thresholds
MIN_CONFIDENCE   = float(os.environ.get('BOT_MIN_CONF',   '0.65'))
MIN_PATTERNS     = int(os.environ.get('BOT_MIN_PATTERNS', '1'))
REQUIRE_VOLUME   = os.environ.get('BOT_REQUIRE_VOL', 'true').lower() == 'true'
SL_ATR_MULT      = float(os.environ.get('BOT_SL_ATR', '1.5'))
TP_RR            = float(os.environ.get('BOT_TP_RR',  '2.0'))

# Grid params
PRICE_MIN  = float(os.environ.get('BOT_PRICE_MIN','80000'))
PRICE_MAX  = float(os.environ.get('BOT_PRICE_MAX','90000'))
NUM_GRIDS  = int(os.environ.get('BOT_NUM_GRIDS','10'))

# DCA
DCA_DROP_PCT   = float(os.environ.get('BOT_DCA_DROP','2'))
DCA_MAX_ORDERS = int(os.environ.get('BOT_DCA_MAX','5'))

# Scalping
SCALP_RSI_BUY  = float(os.environ.get('BOT_SCALP_RSI_BUY','30'))
SCALP_RSI_SELL = float(os.environ.get('BOT_SCALP_RSI_SELL','70'))
SCALP_TP_PCT   = float(os.environ.get('BOT_SCALP_TP','1.5'))
SCALP_SL_PCT   = float(os.environ.get('BOT_SCALP_SL','1.0'))

TREND_FAST   = int(os.environ.get('BOT_TREND_FAST','9'))
TREND_SLOW   = int(os.environ.get('BOT_TREND_SLOW','21'))
MACD_FAST    = int(os.environ.get('BOT_MACD_FAST','12'))
MACD_SLOW    = int(os.environ.get('BOT_MACD_SLOW','26'))
MACD_SIGNAL  = int(os.environ.get('BOT_MACD_SIG','9'))
BREAK_LB     = int(os.environ.get('BOT_BREAK_LOOKBACK','20'))

HISTORY_SIZE = 200

state = {
    'running':       True,
    'candle_count':  0,
    'position':      None,
    'pnl':           0.0,
    'wins':          0,
    'losses':        0,
    'candles':       deque(maxlen=HISTORY_SIZE),
    'raw_closes':    deque(maxlen=HISTORY_SIZE),
    'raw_highs':     deque(maxlen=HISTORY_SIZE),
    'raw_lows':      deque(maxlen=HISTORY_SIZE),
    'raw_volumes':   deque(maxlen=HISTORY_SIZE),
    'tick_closes':   deque(maxlen=50),
    'grid_orders':   [],
    'dca_orders':    [],
    'dca_base_price':0.0,
    'macd_prev_hist':0.0,
    'all_patterns':  [],
    'last_prediction': {},
}

def handle_exit(sig, frame):
    log.info("Sinal de encerramento recebido — finalizando graciosamente...")
    state['running'] = False
    # Don't sys.exit() - let the main loop finish cleanly

signal.signal(signal.SIGTERM, handle_exit)
signal.signal(signal.SIGINT, handle_exit)

# Client será criado em main() após validar as chaves
client = None

# -----------------------------------------------------------------------------
# INDICADORES
# -----------------------------------------------------------------------------

def ema(values, period):
    vals = list(values)
    if len(vals) < period:
        return sum(vals)/len(vals) if vals else 0
    k = 2/(period+1)
    e = vals[0]
    for v in vals[1:]: e = v*k + e*(1-k)
    return e

def rsi(closes, period=14):
    vals = list(closes)[-(period+1):]
    if len(vals) < period+1: return 50
    gains = [max(vals[i]-vals[i-1],0) for i in range(1,len(vals))]
    losses= [max(vals[i-1]-vals[i],0) for i in range(1,len(vals))]
    ag = sum(gains)/period; al = sum(losses)/period
    return 100 if al==0 else 100-(100/(1+ag/al))

def macd(closes, fast=12, slow=26, sig=9):
    vals = list(closes)
    if len(vals) < slow+sig: return 0,0,0
    ef = ema(vals[-fast:], fast); es = ema(vals[-slow:], slow)
    ml = ef - es
    mseries = []
    for i in range(len(vals)-slow, len(vals)):
        mseries.append(ema(vals[max(0,i-fast):i+1],fast) - ema(vals[max(0,i-slow):i+1],slow))
    sl_val = ema(mseries[-sig:], sig)
    return ml, sl_val, ml-sl_val

def atr(highs, lows, closes, period=14):
    h=list(highs)[-(period+1):]; l=list(lows)[-(period+1):]; c=list(closes)[-(period+1):]
    if len(c)<2: return 0
    trs=[max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])) for i in range(1,len(c))]
    return sum(trs)/len(trs) if trs else 0

def trend_direction_from_ema():
    closes = list(state['raw_closes'])
    if len(closes) < TREND_SLOW+2: return 'neutral'
    e_fast = ema(closes[-TREND_FAST:], TREND_FAST)
    e_slow = ema(closes[-TREND_SLOW:], TREND_SLOW)
    if e_fast > e_slow * 1.001: return 'up'
    if e_fast < e_slow * 0.999: return 'down'
    return 'neutral'

# -----------------------------------------------------------------------------
# HELPERS
# -----------------------------------------------------------------------------

_sym_info_cache = {}   # cache para evitar chamada API a cada vela

def get_sym_info():
    global _sym_info_cache
    if _sym_info_cache:
        return _sym_info_cache
    info = client.get_symbol_info(SYMBOL)
    lot  = next(f for f in info['filters'] if f['filterType']=='LOT_SIZE')
    prc  = next((f for f in info['filters'] if f['filterType']=='PRICE_FILTER'), {})
    _sym_info_cache = {
        'min_qty':  float(lot['minQty']),
        'max_qty':  float(lot['maxQty']),
        'step':     float(lot['stepSize']),
        'min_notional': 10.0,  # Binance Spot mínimo ~$10
    }
    log.info(f"  SymInfo: minQty={_sym_info_cache['min_qty']} step={_sym_info_cache['step']}")
    return _sym_info_cache

# Saldo em cache (atualizado antes de cada ordem real)
_usdt_balance_cache = None
_usdt_balance_ts    = 0

# BOT_MARKET: 'spot' (padrão) ou 'futures' — define onde o saldo está
MARKET_TYPE = os.environ.get('BOT_MARKET', 'spot').lower()  # 'spot' | 'futures'

def get_real_usdt_balance() -> float:
    """Consulta saldo USDT real — Spot ou Futures USD-M conforme BOT_MARKET."""
    global _usdt_balance_cache, _usdt_balance_ts
    import time
    now = time.time()
    if _usdt_balance_cache is not None and now - _usdt_balance_ts < 30:
        return _usdt_balance_cache
    try:
        if MARKET_TYPE == 'futures':
            # Futures USD-M: usa futures_account_balance
            balances = client.futures_account_balance()
            usdt = next((b for b in balances if b.get('asset') == 'USDT'), None)
            if usdt:
                # availableBalance = margem livre; walletBalance = saldo total
                avail  = float(usdt.get('availableBalance', 0))
                wallet = float(usdt.get('balance', 0))
                free = avail if avail > 1.0 else wallet  # usa wallet se avail estiver zerado
                if free < 1.0:
                    free = wallet  # fallback para saldo total
            else:
                free = 0.0
            if free > 0:
                log.info(f'  💰 Saldo Futures USDT: available=${avail:.2f} wallet=${wallet:.2f} → usando ${free:.2f}')
        else:
            # Spot padrão
            bal = client.get_asset_balance(asset='USDT')
            free = float(bal.get('free', 0)) if bal else 0.0
        _usdt_balance_cache = free
        _usdt_balance_ts    = now
        log.info(f"  💰 Saldo USDT [{MARKET_TYPE.upper()}]: ${free:.2f}")
        return free
    except Exception as e:
        log.warning(f"  ⚠ Não foi possível verificar saldo ({MARKET_TYPE}): {e}")
        # Se falhou com futures, tenta spot como fallback
        if MARKET_TYPE == 'futures':
            try:
                bal = client.get_asset_balance(asset='USDT')
                spot_free = float(bal.get('free', 0)) if bal else 0.0
                if spot_free > 0:
                    log.info(f"  💰 Fallback para saldo SPOT: ${spot_free:.2f}")
                    _usdt_balance_cache = spot_free
                    _usdt_balance_ts    = __import__('time').time()
                    return spot_free
            except Exception as e2:
                log.warning(f"  ⚠ Fallback spot também falhou: {e2}")
        return _usdt_balance_cache if _usdt_balance_cache is not None else -1.0

def round_step(v, step):
    step_d = Decimal(str(step)).normalize()
    v_d    = Decimal(str(v))
    qty_d  = (v_d // step_d) * step_d
    # Extrai precisão do Decimal normalizado (funciona com 1e-05, 0.001, etc.)
    sign, digits, exp = step_d.as_tuple()
    prec = max(0, -exp)
    return float(round(qty_d, prec))

def safe_qty(capital: float, price: float) -> float:
    """Calcula qty válida para a Binance respeitando saldo real, minQty, stepSize e notional mínimo."""
    if price <= 0: return 0
    info = get_sym_info()

    # -- Verificar saldo real (apenas em modo não-testnet) ----------------------
    effective_capital = capital
    if not TESTNET:
        real_balance = get_real_usdt_balance()
        if real_balance > 0:
            if real_balance < 10:
                log.error(f"  ❌ Saldo insuficiente: ${real_balance:.2f} USDT (mínimo ~$10)")
                _notify_low_balance(real_balance)
                return 0
            if real_balance < capital:
                log.warning(f"  ⚠ Capital config (${capital:.2f}) > saldo livre (${real_balance:.2f}) — usando ${real_balance * 0.95:.2f}")
                effective_capital = real_balance * 0.95
            # else: saldo >= capital → usa capital configurado
        else:
            # Não conseguiu verificar saldo (API falhou, permissão, etc.)
            # Usa capital configurado diretamente — a ordem vai falhar se não tiver saldo
            log.warning(f"  ⚠ Não verificou saldo real — usando capital configurado ${capital:.2f}")
            effective_capital = capital

    qty  = round_step(effective_capital / price * 0.95, info['step'])
    # Garante notional mínimo (qty * price >= $10)
    min_notional_qty = round_step(info['min_notional'] / price * 1.05, info['step'])
    qty = max(qty, min_notional_qty)
    if qty < info['min_qty']:
        log.warning(f"  ⚠ qty={qty} < minQty={info['min_qty']} — capital ${effective_capital:.2f} insuficiente para {SYMBOL}")
        return 0
    if qty > info['max_qty']:
        qty = round_step(info['max_qty'], info['step'])
    return qty

def _notify_low_balance(balance: float):
    """Notifica via Telegram quando saldo é insuficiente para operar."""
    try:
        from telegram_notify import notify_error
        notify_error(f"💸 Saldo USDT insuficiente para operar!\n\nSaldo atual: ${balance:.2f}\nMínimo necessário: ~$10\n\nRecarregue sua conta para retomar as operações.")
    except Exception: pass
    log.error(f"  🚨 SALDO INSUFICIENTE: ${balance:.2f} — bot aguardando recarga")

def place_order(side, qty, price=None, otype=ORDER_TYPE_MARKET):
    info = get_sym_info()
    if qty <= 0 or qty < info['min_qty']:
        log.error(f"  ❌ Ordem bloqueada: qty={qty} inválida (min={info['min_qty']})")
        return None
    if TESTNET:
        log.info(f"  [TESTNET] {side} {qty:.6f} @ {'MARKET' if not price else f'${price:,.2f}'}")
        return {'orderId': 0, 'side': side, 'executedQty': qty}
    p = dict(symbol=SYMBOL, side=side, type=otype, quantity=qty)
    if price and otype==ORDER_TYPE_LIMIT:
        p['timeInForce']=TIME_IN_FORCE_GTC; p['price']=f'{price:.2f}'
    try:
        # Limpar cache de saldo antes de ordem real (força re-leitura na próxima vez)
        global _usdt_balance_cache, _usdt_balance_ts
        _usdt_balance_cache = None
        if MARKET_TYPE == 'futures':
            result = client.futures_create_order(**p)
        else:
            result = client.create_order(**p)
        log.info(f"  ✅ Ordem executada: {result.get('orderId')} {side} {qty}")
        return result
    except Exception as e:
        err = str(e)
        if '-2010' in err or 'insufficient balance' in err.lower():
            # Saldo real insuficiente — limpa cache e notifica
            _usdt_balance_cache = None
            real_bal = get_real_usdt_balance()
            log.error(f"  ❌ Saldo insuficiente ao executar ordem! Saldo atual: ${real_bal:.2f}")
            _notify_low_balance(real_bal)
            # Não re-lança — bot continua rodando, apenas não operou
            return None
        elif '-1121' in err or 'invalid symbol' in err.lower():
            log.error(f"  ❌ Símbolo inválido: {SYMBOL}")
            return None
        elif '-1013' in err or 'notional' in err.lower():
            log.error(f"  ❌ Valor da ordem abaixo do mínimo (notional) — qty={qty} preço≈{price}")
            return None
        else:
            log.error(f"  ❌ Erro ao criar ordem: {e}")
            raise  # re-lança erros desconhecidos para log

def open_long(price, qty, sl, tp, reason=''):
    log.info(f"  🟢 LONG {qty:.6f} @ ${price:,.2f} | SL ${sl:,.2f} | TP ${tp:,.2f} | {reason}")
    place_order(SIDE_BUY, qty)
    state['position'] = {'side':'BUY','entry':price,'qty':qty,'sl':sl,'tp':tp}
    pats = [p.name for p in state.get('all_patterns', [])[:3]]
    conf = state.get('last_prediction', {}).get('confidence', 0)
    notify_entry('BUY', SYMBOL, price, qty, sl, tp, reason, confidence=conf, patterns=pats)
    _live_event('position_open', {'side':'BUY','pair':SYMBOL,'entry':price,'sl':sl,'tp':tp,'qty':qty,'reason':reason})
    _save_trade_open('BUY', SYMBOL, price, qty, sl, tp, STRATEGY)

def open_short(price, qty, sl, tp, reason=''):
    log.info(f"  🔴 SHORT {qty:.6f} @ ${price:,.2f} | SL ${sl:,.2f} | TP ${tp:,.2f} | {reason}")
    place_order(SIDE_SELL, qty)
    state['position'] = {'side':'SELL','entry':price,'qty':qty,'sl':sl,'tp':tp}
    pats = [p.name for p in state.get('all_patterns', [])[:3]]
    conf = state.get('last_prediction', {}).get('confidence', 0)
    notify_entry('SELL', SYMBOL, price, qty, sl, tp, reason, confidence=conf, patterns=pats)
    _live_event('position_open', {'side':'SELL','pair':SYMBOL,'entry':price,'sl':sl,'tp':tp,'qty':qty,'reason':reason})
    _save_trade_open('SELL', SYMBOL, price, qty, sl, tp, STRATEGY)

def close_position(current_price, reason=''):
    pos = state['position']
    if not pos: return
    side = SIDE_SELL if pos['side']=='BUY' else SIDE_BUY
    info = get_sym_info()
    qty  = round_step(pos['qty'], info['step'])
    log.info(f"  ⬛ Fechando {pos['side']} @ ${current_price:,.2f} | {reason}")
    place_order(side, qty)
    pnl = (current_price - pos['entry']) * pos['qty'] if pos['side']=='BUY' \
          else (pos['entry'] - current_price) * pos['qty']
    state['pnl'] += pnl
    if pnl >= 0: state['wins'] += 1
    else:        state['losses'] += 1
    log.info(f"  💵 PnL trade: ${pnl:+.2f} | Acumulado: ${state['pnl']:+.2f}")
    notify_exit(pos['side'], SYMBOL, pos['entry'], current_price, pnl, reason,
                wins=state['wins'], losses=state['losses'], total_pnl=state['pnl'])
    _live_event('position_close', {'pair':SYMBOL,'side':pos['side'],'entry':pos['entry'],'exit':current_price,'pnl':pnl,'reason':reason})
    _save_trade_close(current_price, pnl, reason)
    state['position'] = None

def check_sl_tp(price):
    pos = state['position']
    if not pos: return
    if pos['side']=='BUY':
        if price <= pos['sl']: close_position(price,'STOP LOSS')
        elif price >= pos['tp']: close_position(price,'TAKE PROFIT')
    else:
        if price >= pos['sl']: close_position(price,'STOP LOSS')
        elif price <= pos['tp']: close_position(price,'TAKE PROFIT')

# -----------------------------------------------------------------------------
# STRATEGY: PATTERN ENGINE (principal)
# -----------------------------------------------------------------------------

def pattern_engine_on_candle(close, candle_obj):
    """
    A cada vela fechada:
    1. Roda todos os detectores de padrões
    2. Prevê o próximo movimento
    3. Entra/sai baseado na predição + confirmações técnicas
    """
    candles = list(state['candles'])
    if len(candles) < 5:
        log.info(f"  Aquecendo padrões... ({len(candles)}/5)")
        return

    trend     = trend_direction_from_ema()
    patterns, prediction = run_all(candles, trend)

    state['all_patterns']    = patterns
    state['last_prediction'] = prediction

    log.info(f"\n  ┌- PADRÕES DETECTADOS ({len(patterns)}) {'-'*35}")
    if patterns:
        for p in patterns[:5]:  # top 5
            log.info(f"  │  {p}")
    else:
        log.info(f"  │  Nenhum padrão identificado nesta vela")

    dir_   = prediction.get('direction','neutral')
    conf_  = prediction.get('confidence', 0)
    tgt_   = prediction.get('target_pct', 0)
    score_ = prediction.get('score', 0)

    log.info(f"  ├- PREDIÇÃO PRÓXIMO MOVIMENTO:")
    log.info(f"  │  Direção: {dir_.upper()} | Confiança: {conf_:.0%} | Alvo: {tgt_:+.1f}%")
    for r in prediction.get('reasoning', [])[:4]:
        log.info(f"  │  {r}")
    log.info(f"  └{'-'*50}")
    # Notifica Live Trading com o sinal detectado
    if conf_ >= MIN_CONFIDENCE:
        top_pat_names = [p.name for p in patterns[:2]] if patterns else []
        _live_event('signal', {
            'direction': dir_, 'confidence': round(conf_*100),
            'pair': SYMBOL, 'pattern': ', '.join(top_pat_names) if top_pat_names else 'sem padrão',
            'alvo': f'{tgt_:+.1f}%'
        })

    # SL/TP dinâmico baseado no ATR
    atr_val   = atr(state['raw_highs'], state['raw_lows'], state['raw_closes'])
    sl_dist   = max(atr_val * SL_ATR_MULT, close * 0.01)
    tp_dist   = sl_dist * TP_RR
    qty = safe_qty(CAPITAL, close)
    if qty <= 0: return

    # Verifica posição aberta
    check_sl_tp(close)

    if state['position']:
        return  # já tem posição — aguarda SL/TP

    # Condições de entrada
    high_conf_bull = (patterns and
                      any(p.signal in (Signal.STRONG_BUY, Signal.BUY) and p.confidence >= MIN_CONFIDENCE
                          for p in patterns) and
                      dir_ == 'up' and conf_ >= MIN_CONFIDENCE)

    high_conf_bear = (patterns and
                      any(p.signal in (Signal.STRONG_SELL, Signal.SELL) and p.confidence >= MIN_CONFIDENCE
                          for p in patterns) and
                      dir_ == 'down' and conf_ >= MIN_CONFIDENCE)

    # Filtro de volume (opcional)
    vol_ok = True
    if REQUIRE_VOLUME and len(state['raw_volumes']) >= 5:
        vols    = list(state['raw_volumes'])
        avg_vol = sum(vols[-5:-1]) / 4
        vol_ok  = candle_obj.volume >= avg_vol * 0.8

    # Filtros adicionais de RSI para evitar entrar em extremos
    rsi_val = rsi(state['raw_closes'])
    rsi_ok_long  = rsi_val < 72
    rsi_ok_short = rsi_val > 28

    if high_conf_bull and vol_ok and rsi_ok_long:
        top_pat   = patterns[0]
        pat_names = [p.name for p in patterns[:3]]
        sl_price  = close - sl_dist
        tp_price  = close + tp_dist
        reason_str = f"{top_pat.name} | RSI {rsi_val:.0f} | conf {conf_:.0%}"
        if TRADE_MODE == 'manual':
            confirmed = request_entry_confirmation_v2(
                SYMBOL, 'BUY', close, sl_price, tp_price,
                conf_, pat_names, rsi_val, timeout_sec=90)
            if confirmed:
                open_long(close, qty, sl=sl_price, tp=tp_price, reason=reason_str)
            else:
                log.info('  🖐 Entrada LONG cancelada / timeout (modo manual)')
        else:
            notify_signal(SYMBOL, 'up', conf_, patterns=pat_names,
                          reason=f'RSI {rsi_val:.0f} | Entrando LONG...')
            open_long(close, qty, sl=sl_price, tp=tp_price, reason=reason_str)

    elif high_conf_bear and vol_ok and rsi_ok_short:
        top_pat   = patterns[0]
        pat_names = [p.name for p in patterns[:3]]
        sl_price  = close + sl_dist
        tp_price  = close - tp_dist
        reason_str = f"{top_pat.name} | RSI {rsi_val:.0f} | conf {conf_:.0%}"
        if TRADE_MODE == 'manual':
            confirmed = request_entry_confirmation_v2(
                SYMBOL, 'SELL', close, sl_price, tp_price,
                conf_, pat_names, rsi_val, timeout_sec=90)
            if confirmed:
                open_short(close, qty, sl=sl_price, tp=tp_price, reason=reason_str)
            else:
                log.info('  🖐 Entrada SHORT cancelada / timeout (modo manual)')
        else:
            notify_signal(SYMBOL, 'down', conf_, patterns=pat_names,
                          reason=f'RSI {rsi_val:.0f} | Entrando SHORT...')
            open_short(close, qty, sl=sl_price, tp=tp_price, reason=reason_str)


# -----------------------------------------------------------------------------
# STRATEGIES: GRID, DCA, SCALP, TREND, MACD (mantidas do v3)
# -----------------------------------------------------------------------------

def grid_init():
    info=get_sym_info(); step=(PRICE_MAX-PRICE_MIN)/NUM_GRIDS
    mid=(PRICE_MIN+PRICE_MAX)/2; cpg=CAPITAL/NUM_GRIDS
    log.info(f"  📊 Grid ${PRICE_MIN:,.0f}–${PRICE_MAX:,.0f} | {NUM_GRIDS} grades")
    for i in range(NUM_GRIDS+1):
        price=round(PRICE_MIN+i*step,2); qty=round_step(cpg/price,info['step'])
        if qty<info['min_qty']: continue
        side=SIDE_BUY if price<mid else SIDE_SELL
        try:
            o=client.create_order(symbol=SYMBOL,side=side,type=ORDER_TYPE_LIMIT,
                                  timeInForce=TIME_IN_FORCE_GTC,quantity=qty,price=f'{price:.2f}')
            state['grid_orders'].append(o)
        except Exception as e: log.error(f"  Grid ordem erro: {e}")
    log.info(f"  {len(state['grid_orders'])} ordens criadas")

def grid_on_candle(close):
    try:
        open_ids={o['orderId'] for o in client.get_open_orders(symbol=SYMBOL)}
        info=get_sym_info()
        for order in list(state['grid_orders']):
            if order['orderId'] in open_ids or order['orderId']==0: continue
            try: filled=client.get_order(symbol=SYMBOL,orderId=order['orderId'])
            except: continue
            if filled['status']!='FILLED': continue
            state['grid_orders'].remove(order)
            price=float(filled['price']); qty=float(filled['executedQty'])
            side=filled['side']; pnl=(price-CAPITAL/NUM_GRIDS/qty)*qty if side=='SELL' else 0
            state['pnl']+=pnl
            log.info(f"  ✅ Grid {side} {qty}@${price:.0f} PnL ${pnl:.2f}")
            new_side=SIDE_BUY if side=='SELL' else SIDE_SELL
            try:
                o=client.create_order(symbol=SYMBOL,side=new_side,type=ORDER_TYPE_LIMIT,
                                      timeInForce=TIME_IN_FORCE_GTC,
                                      quantity=round_step(qty,info['step']),price=f'{price:.2f}')
                state['grid_orders'].append(o)
            except Exception as e: log.error(f"  Ping-pong erro: {e}")
    except Exception as e: log.error(f"  grid_on_candle: {e}")

def dca_on_candle(close):
    info=get_sym_info(); qpr=round_step(CAPITAL/DCA_MAX_ORDERS/close,info['step'])
    if not state['dca_orders']:
        place_order(SIDE_BUY,qpr)
        state['dca_orders'].append({'price':close,'qty':qpr})
        state['dca_base_price']=close
        log.info(f"  💰 DCA entrada inicial @ ${close:,.2f}"); return
    total_qty=sum(o['qty'] for o in state['dca_orders'])
    avg_price=sum(o['price']*o['qty'] for o in state['dca_orders'])/total_qty
    drop_pct=(state['dca_base_price']-close)/state['dca_base_price']*100
    gain_pct=(close-avg_price)/avg_price*100
    if gain_pct>=DCA_DROP_PCT and total_qty>=info['min_qty']:
        pnl=(close-avg_price)*total_qty; state['pnl']+=pnl; state['wins']+=1
        place_order(SIDE_SELL,round_step(total_qty,info['step']))
        log.info(f"  ✅ DCA VENDA @ ${close:,.2f} PnL +${pnl:.2f}")
        state['dca_orders'].clear(); state['dca_base_price']=0.0; return
    if drop_pct>=DCA_DROP_PCT*len(state['dca_orders']) and len(state['dca_orders'])<DCA_MAX_ORDERS:
        qty=round_step(CAPITAL/DCA_MAX_ORDERS/close,info['step'])
        if qty>=info['min_qty']:
            place_order(SIDE_BUY,qty)
            state['dca_orders'].append({'price':close,'qty':qty})
            log.info(f"  💰 DCA +1 ordem @ ${close:,.2f} (queda {drop_pct:.1f}%)")

def scalping_on_tick(price):
    state['tick_closes'].append(price)
    check_sl_tp(price)
    if len(state['tick_closes'])<15 or state['position']: return
    r=rsi(state['tick_closes'],14)
    qty=safe_qty(CAPITAL, price)
    if qty<=0: return
    if r<SCALP_RSI_BUY:
        sl=price*(1-SCALP_SL_PCT/100); tp=price*(1+SCALP_TP_PCT/100)
        reason=f"RSI {r:.0f}"
        if TRADE_MODE=='manual':
            confirmed=request_entry_confirmation_v2('BUY',SYMBOL,price,qty,sl,tp,reason,timeout=90)
            if confirmed: open_long(price,qty,sl,tp,reason)
            else: log.info('  🖐 Scalp LONG cancelado (manual)')
        else:
            open_long(price,qty,sl,tp,reason)
    elif r>SCALP_RSI_SELL:
        sl=price*(1+SCALP_SL_PCT/100); tp=price*(1-SCALP_TP_PCT/100)
        reason=f"RSI {r:.0f}"
        if TRADE_MODE=='manual':
            confirmed=request_entry_confirmation_v2('SELL',SYMBOL,price,qty,sl,tp,reason,timeout=90)
            if confirmed: open_short(price,qty,sl,tp,reason)
            else: log.info('  🖐 Scalp SHORT cancelado (manual)')
        else:
            open_short(price,qty,sl,tp,reason)

def trend_on_candle(close):
    if len(state['raw_closes'])<TREND_SLOW+5: return
    closes=list(state['raw_closes'])
    ef=ema(closes[-TREND_FAST:],TREND_FAST); es=ema(closes[-TREND_SLOW:],TREND_SLOW)
    r=rsi(state['raw_closes']); a=atr(state['raw_highs'],state['raw_lows'],state['raw_closes'])
    sl_d=max(a*1.5,close*0.02); tp_d=sl_d*2
    check_sl_tp(close)
    if state['position']: return
    qty=safe_qty(CAPITAL, close)
    if qty<=0: return
    if ef>es*1.001 and r<65:
        reason=f"EMA{TREND_FAST}>{TREND_SLOW} RSI{r:.0f}"
        if TRADE_MODE == 'manual':
            confirmed = request_entry_confirmation_v2(
                'BUY', SYMBOL, close, qty, close-sl_d, close+tp_d, reason, timeout=90)
            if confirmed:
                open_long(close,qty,close-sl_d,close+tp_d,reason)
            else:
                log.info('  🖐 Entrada LONG (Trend) cancelada pelo usuário (modo manual)')
        else:
            open_long(close,qty,close-sl_d,close+tp_d,reason)
    elif ef<es*0.999 and r>35:
        reason=f"EMA{TREND_FAST}<{TREND_SLOW} RSI{r:.0f}"
        if TRADE_MODE == 'manual':
            confirmed = request_entry_confirmation_v2(
                'SELL', SYMBOL, close, qty, close+sl_d, close-tp_d, reason, timeout=90)
            if confirmed:
                open_short(close,qty,close+sl_d,close-tp_d,reason)
            else:
                log.info('  🖐 Entrada SHORT (Trend) cancelada pelo usuário (modo manual)')
        else:
            open_short(close,qty,close+sl_d,close-tp_d,reason)

def macd_on_candle(close):
    if len(state['raw_closes'])<MACD_SLOW+MACD_SIGNAL+5: return
    ml,sl,hist=macd(state['raw_closes'],MACD_FAST,MACD_SLOW,MACD_SIGNAL)
    r=rsi(state['raw_closes']); a=atr(state['raw_highs'],state['raw_lows'],state['raw_closes'])
    sl_d=max(a*1.5,close*0.015); prev=state['macd_prev_hist']
    check_sl_tp(close)
    qty=safe_qty(CAPITAL, close)
    if qty<=0: return
    if not state['position']:
        if prev<0 and hist>0 and r<65:
            reason=f"MACD cross↑ RSI{r:.0f}"
            if TRADE_MODE=='manual':
                confirmed=request_entry_confirmation_v2('BUY',SYMBOL,close,qty,close-sl_d,close+sl_d*2,reason,timeout=90)
                if confirmed: open_long(close,qty,close-sl_d,close+sl_d*2,reason)
                else: log.info('  🖐 MACD LONG cancelado (manual)')
            else:
                open_long(close,qty,close-sl_d,close+sl_d*2,reason)
        elif prev>0 and hist<0 and r>35:
            reason=f"MACD cross↓ RSI{r:.0f}"
            if TRADE_MODE=='manual':
                confirmed=request_entry_confirmation_v2('SELL',SYMBOL,close,qty,close+sl_d,close-sl_d*2,reason,timeout=90)
                if confirmed: open_short(close,qty,close+sl_d,close-sl_d*2,reason)
                else: log.info('  🖐 MACD SHORT cancelado (manual)')
            else:
                open_short(close,qty,close+sl_d,close-sl_d*2,reason)
    state['macd_prev_hist']=hist

def breakout_on_candle(close):
    if len(state['raw_highs'])<BREAK_LB: return
    wins=list(state['raw_highs'])[-BREAK_LB:]; wlows=list(state['raw_lows'])[-BREAK_LB:]
    res=max(wins); sup=min(wlows)
    vols=list(state['raw_volumes']); avg_v=sum(vols[-10:])/10 if len(vols)>=10 else 0
    last_v=vols[-1] if vols else 0
    a=atr(state['raw_highs'],state['raw_lows'],state['raw_closes'])
    sl_d=max(a*2,close*0.015)
    check_sl_tp(close)
    if state['position']: return
    qty=safe_qty(CAPITAL, close)
    if qty<=0: return
    vol_ok=last_v>avg_v*1.2 if avg_v else True
    if close>res*(1+0.003) and vol_ok:
        reason=f"Break resistência ${res:,.0f}"
        if TRADE_MODE=='manual':
            confirmed=request_entry_confirmation_v2('BUY',SYMBOL,close,qty,close-sl_d,close+sl_d*2,reason,timeout=90)
            if confirmed: open_long(close,qty,close-sl_d,close+sl_d*2,reason)
            else: log.info('  🖐 Breakout LONG cancelado (manual)')
        else:
            open_long(close,qty,close-sl_d,close+sl_d*2,reason)
    elif close<sup*(1-0.003) and vol_ok:
        reason=f"Break suporte ${sup:,.0f}"
        if TRADE_MODE=='manual':
            confirmed=request_entry_confirmation_v2('SELL',SYMBOL,close,qty,close+sl_d,close-sl_d*2,reason,timeout=90)
            if confirmed: open_short(close,qty,close+sl_d,close-sl_d*2,reason)
            else: log.info('  🖐 Breakout SHORT cancelado (manual)')
        else:
            open_short(close,qty,close+sl_d,close-sl_d*2,reason)

# -----------------------------------------------------------------------------
# WebSocket Handlers
# -----------------------------------------------------------------------------

def on_kline(msg):
    if not state['running']: return
    if msg.get('e')=='error': log.error(f"WS error: {msg}"); return

    k        = msg.get('k',{})
    close    = float(k.get('c',0))
    high     = float(k.get('h',0))
    low      = float(k.get('l',0))
    opn      = float(k.get('o',0))
    vol      = float(k.get('v',0))
    is_close = k.get('x',False)

    # Tick-level
    if STRATEGY=='scalping': scalping_on_tick(close); return
    if STRATEGY=='hft':
        engine = get_hft_engine()
        if engine:
            engine._check_exit(SYMBOL, close)
    if state['position']:    check_sl_tp(close)
    if STOP_LOSS>0 and close<=STOP_LOSS:
        log.warning(f"  ⛔ Stop global ${close:,.2f}!")
        notify_stop_loss_global(SYMBOL, close)
        try: client.cancel_open_orders(symbol=SYMBOL)
        except: pass
        close_position(close,'STOP GLOBAL')
        state['running']=False; return

    # -- Session Manager: para ao atingir gain ou loss da sessão --
    if SESSION_GAIN > 0 and state['pnl'] >= SESSION_GAIN:
        log.info(f"  🎯 SESSION GAIN atingido: ${state['pnl']:+.2f} >= ${SESSION_GAIN:.2f}")
        if state['position']: close_position(close, 'SESSION GAIN')
        notify_session_target('gain', SYMBOL, state['pnl'], SESSION_GAIN,
                              state['wins'], state['losses'])
        state['running'] = False; return

    if SESSION_LOSS > 0 and state['pnl'] <= -SESSION_LOSS:
        log.info(f"  🛑 SESSION LOSS atingido: ${state['pnl']:+.2f} <= -${SESSION_LOSS:.2f}")
        if state['position']: close_position(close, 'SESSION LOSS')
        notify_session_target('loss', SYMBOL, state['pnl'], SESSION_LOSS,
                              state['wins'], state['losses'])
        state['running'] = False; return
    if not is_close: return

    # -- VELA FECHADA -----------------------------------------------
    state['candle_count'] += 1
    candle_obj = Candle(open=opn, high=high, low=low, close=close, volume=vol)
    state['candles'].append(candle_obj)
    state['raw_closes'].append(close)
    state['raw_highs'].append(high)
    state['raw_lows'].append(low)
    state['raw_volumes'].append(vol)

    n   = state['candle_count']
    wr  = state['wins'] / max(1, state['wins']+state['losses']) * 100
    r   = rsi(state['raw_closes'])
    a   = atr(state['raw_highs'], state['raw_lows'], state['raw_closes'])

    log.info(f"\n{'='*62}")
    log.info(f"  🕯 Vela #{n} [{TIMEFRAME}] {SYMBOL} | "
             f"O:{opn:,.0f} H:{high:,.0f} L:{low:,.0f} C:{close:,.0f}")
    log.info(f"  PnL: ${state['pnl']:+.2f} | W:{state['wins']} L:{state['losses']} "
             f"WR:{wr:.0f}% | RSI:{r:.0f} | ATR:${a:,.0f} | Estratégia: {STRATEGY.upper()}")
    if state['position']:
        pos=state['position']
        dist=abs(close-pos['sl'])/close*100
        log.info(f"  📍 Posição: {pos['side']} @ ${pos['entry']:,.2f} | "
                 f"SL ${pos['sl']:,.2f} ({dist:.1f}% dist) | TP ${pos['tp']:,.2f}")

    if   STRATEGY in ('pattern','auto'): pattern_engine_on_candle(close, candle_obj)
    elif STRATEGY=='grid':               grid_on_candle(close)
    elif STRATEGY=='dca':                dca_on_candle(close)
    elif STRATEGY=='trend':              trend_on_candle(close)
    elif STRATEGY=='macd':               macd_on_candle(close)
    elif STRATEGY=='breakout':           breakout_on_candle(close)
    elif STRATEGY=='hft':
        engine = get_hft_engine()
        if engine:
            engine.on_candle(SYMBOL, opn, high, low, close, vol, is_close)


def on_ticker(msg):
    if not state['running']: return
    price = float(msg.get('c',0))
    if price and STRATEGY=='scalping': scalping_on_tick(price)

# -----------------------------------------------------------------------------
# Warm-up
# -----------------------------------------------------------------------------

def warm_up():
    needed = max(HISTORY_SIZE, MACD_SLOW+MACD_SIGNAL+10, BREAK_LB+5, 50)
    log.info(f"  Carregando {needed} velas históricas ({TIMEFRAME})...")
    try:
        klines = client.get_klines(symbol=SYMBOL, interval=TIMEFRAME, limit=needed)
        for k in klines[:-1]:
            opn=float(k[1]); high=float(k[2]); low=float(k[3]); close=float(k[4]); vol=float(k[5])
            state['candles'].append(Candle(open=opn,high=high,low=low,close=close,volume=vol))
            state['raw_closes'].append(close)
            state['raw_highs'].append(high)
            state['raw_lows'].append(low)
            state['raw_volumes'].append(vol)
        log.info(f"  {len(state['candles'])} velas carregadas.")
        # Roda os padrões no histórico (diagnóstico inicial)
        candles_list = list(state['candles'])
        pats, pred   = run_all(candles_list, trend_direction_from_ema())
        log.info(f"  Padrões no histórico: {len(pats)}")
        for p in pats[:3]: log.info(f"    {p}")
        log.info(f"  Predição inicial: {pred.get('direction','?').upper()} "
                 f"conf={pred.get('confidence',0):.0%} alvo={pred.get('target_pct',0):+.1f}%")
    except Exception as e:
        log.warning(f"  Warm-up falhou: {e}")

# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------

def main():
    global client
    # Escreve PID file para que o servidor Node possa rastrear este processo
    # PID tracking — salva em arquivo se disponível (opcional, usado por alguns deploys)
    pid_file = os.environ.get('BOT_PID_FILE', '')
    if pid_file:
        try:
            os.makedirs(os.path.dirname(pid_file), exist_ok=True)
            with open(pid_file, 'w') as f:
                f.write(str(os.getpid()))
        except Exception:
            pass  # Não fatal — server rastreia via pgrep

    # Recarrega chaves a cada tentativa (podem ter sido injetadas após o início)
    api_key    = os.environ.get('BINANCE_API_KEY',    API_KEY)
    secret_key = os.environ.get('BINANCE_SECRET_KEY', SECRET_KEY)

    if not api_key or not secret_key:
        log.error("Configure BINANCE_API_KEY e BINANCE_SECRET_KEY no Perfil da plataforma.")
        log.error("O bot será encerrado. Corrija as chaves e reinicie.")
        sys.exit(2)  # exit code 2 = erro de config, PM2 não deve reiniciar

    try:
        client = Client(api_key, secret_key, testnet=TESTNET)
        client.ping()
        log.info("  Binance: OK")
    except Exception as e:
        log.error(f"  Falha ao conectar na Binance: {e}")
        sys.exit(1)

    log.info(f"\n{'='*62}")
    log.info(f"  🚀 CryptoEdge Pro — {STRATEGY.upper()}")
    log.info(f"  Par: {SYMBOL} | Capital: ${CAPITAL} | Testnet: {TESTNET}")
    # Só notifica no primeiro start, não nos restarts silenciosos
    if os.environ.get('_BOT_FIRST_RUN', '1') == '1':
        notify_start(SYMBOL, STRATEGY, CAPITAL, TESTNET)
    else:
        log.info("  🔄 Reconectando (sem notificação Telegram)...")
        # Reinicia o poller do Telegram se modo manual
        if TRADE_MODE == 'manual':
            try:
                from telegram_notify import _start_poller
                _start_poller()
            except Exception: pass
    log.info(f"  Timeframe: {TIMEFRAME} | Stop global: ${STOP_LOSS:,.0f}")
    if SESSION_GAIN > 0 or SESSION_LOSS > 0:
        log.info(f"  🎯 Session Manager: GAIN +${SESSION_GAIN:.2f} | LOSS -${SESSION_LOSS:.2f}")
    if STRATEGY in ('pattern','auto'):
        log.info(f"  Pattern Engine: conf≥{MIN_CONFIDENCE:.0%} | "
                 f"SL={SL_ATR_MULT}×ATR | TP={TP_RR}×SL | Volume: {REQUIRE_VOLUME}")
    log.info(f"{'='*62}\n")

    # -- Multi-par Scanner ------------------------------------------------
    if SCAN_ENABLED:
        scan_pairs = [p.strip() for p in SCAN_PAIRS_RAW.split(',') if p.strip()] or None
        def _on_scan_signal(sig):
            sym  = sig['symbol']
            dir_ = sig['direction']
            conf = sig['confidence']
            pats = sig['patterns']
            price = sig['price']
            rsi   = sig.get('rsi', 0)
            tgt   = sig.get('target_pct', 0)
            icon  = '🔼' if dir_ == 'up' else '🔽'
            # Notifica via Telegram com botão de entrada
            if TRADE_MODE == 'manual':
                # Calcula SL/TP estimados para o sinal do scanner
                sl_pct = 0.015
                tp_pct = sl_pct * float(os.environ.get('BOT_TP_RR', '2.0'))
                sl_est = price * (1 - sl_pct) if dir_ == 'up' else price * (1 + sl_pct)
                tp_est = price * (1 + tp_pct) if dir_ == 'up' else price * (1 - tp_pct)
                side   = 'BUY' if dir_ == 'up' else 'SELL'
                confirmed = request_entry_confirmation_v2(
                    sym, side, price, sl_est, tp_est, conf, pats, rsi, timeout_sec=90)
                if confirmed:
                    log.info(f'  ✅ Scanner: usuário confirmou entrada em {sym}')
                    # Se o par coincide com o par principal, usa open_long/short
                    if sym == SYMBOL and not state['position']:
                        qty = round_step(CAPITAL / price * 0.95, get_sym_info()['step'])
                        if dir_ == 'up': open_long(price, qty, sl_est, tp_est, ', '.join(pats))
                        else:            open_short(price, qty, sl_est, tp_est, ', '.join(pats))
                    else:
                        log.info(f'  ℹ️ {sym} ≠ {SYMBOL} ou posição aberta — sinal registrado apenas')
            else:
                notify_signal(sym, dir_, conf, patterns=pats,
                              reason=f'RSI {rsi:.0f} | alvo {tgt:+.1f}%')
            # Notifica live state
            _live_event('signal', {'direction': dir_, 'confidence': round(conf*100),
                                   'pair': sym, 'pattern': ', '.join(pats[:2]),
                                   'alvo': f'{tgt:+.1f}%'})

        multi_scanner.start(
            api_key, secret_key, _on_scan_signal,
            pairs=scan_pairs, timeframe=TIMEFRAME,
            min_conf=SCAN_MIN_CONF, interval_sec=SCAN_INTERVAL,
            testnet=TESTNET
        )
        log.info(f'  🔭 Scanner ativo — {len(scan_pairs) if scan_pairs else 15} pares | '
                 f'intervalo={SCAN_INTERVAL}s')

    if STRATEGY != 'hft':
        warm_up()
    if STRATEGY=='grid': grid_init()

    # -- HFT: inicializa engine e agenda reset diário -------------------------
    if STRATEGY == 'hft':
        def _hft_send(text):
            try:
                from telegram_notify import _send
                _send(text)
            except Exception: pass

        # ── AUTO-CALIBRAÇÃO: roda backtest para achar params ótimos por par ──
        try:
            from hft_calibrator import run_calibration, needs_calibration
            from binance.client import Client as _CalibClient
            if needs_calibration():
                log.info("  🔬 Iniciando auto-calibração HFT (1ª vez ou expirada)...")
                try:
                    _calib_client = _CalibClient(api_key, secret_key, testnet=False)
                except Exception:
                    _calib_client = client
                def _run_calib_bg():
                    try:
                        run_calibration(_calib_client, HFT_PAIRS, HFT_TIMEFRAME)
                    except Exception as _ce:
                        log.warning(f"  Calibração falhou: {_ce} — usando parâmetros padrão")
                import threading as _th
                _th.Thread(target=_run_calib_bg, daemon=True).start()
                log.info("  🔬 Calibração rodando em background — bot inicia em paralelo")
            else:
                log.info("  ✅ Calibração HFT válida carregada — sem necessidade de recalibrar")
        except Exception as _ce2:
            log.warning(f"  Calibrador indisponível: {_ce2}")

        hft = init_hft(CAPITAL, client, notify_fn=_hft_send)
        log.info(f"  🚀 HFT Engine v3.1 iniciado | Pares: {','.join(HFT_PAIRS[:5])}... | TF: {HFT_TIMEFRAME}")

        # Reset diário à meia-noite
        def _hft_daily_reset():
            import datetime
            while state['running']:
                now = datetime.datetime.now()
                tomorrow = (now + datetime.timedelta(days=1)).replace(
                    hour=0, minute=0, second=30, microsecond=0)
                secs = (tomorrow - now).total_seconds()
                time.sleep(secs)
                if state['running'] and get_hft_engine():
                    # Recalibra parâmetros com dados frescos antes de resetar
                    try:
                        from hft_calibrator import run_calibration
                        from binance.client import Client as _RCClient
                        _rc = _RCClient(api_key, secret_key, testnet=False)
                        log.info("  Recalibracao noturna HFT iniciando...")
                        run_calibration(_rc, HFT_PAIRS, HFT_TIMEFRAME)
                        log.info("  Recalibracao noturna concluida")
                    except Exception as _rce:
                        log.warning(f"  Recalibracao noturna falhou: {_rce}")
                    get_hft_engine().reset_daily()

        threading.Thread(target=_hft_daily_reset, daemon=True).start()

        # Periodic status update every 4 hours
        def _hft_periodic_update():
            import datetime as _dt
            while state['running']:
                time.sleep(4 * 3600)  # 4 hours
                eng = get_hft_engine()
                if eng and state['running']:
                    total = eng.daily_wins + eng.daily_losses
                    if total > 0:
                        wr = eng.daily_wins / total * 100
                        pnl_icon = '🟢' if eng.daily_pnl >= 0 else '🔴'
                        try:
                            from telegram_notify import _send
                            _send(
                                f'⏰ <b>HFT Update ({_dt.datetime.now().strftime("%H:%M")})</b>\n'
                                f'{pnl_icon} PnL hoje: <code>{"+"if eng.daily_pnl>=0 else ""}${eng.daily_pnl:.4f}</code>\n'
                                f'📈 {total} trades | {eng.daily_wins}W/{eng.daily_losses}L | WR:{wr:.0f}%\n'
                                f'📌 Posições abertas: {len(eng.positions)}'
                            )
                        except Exception: pass
        threading.Thread(target=_hft_periodic_update, daemon=True).start()

        # Pre-load CLOSED klines from LIVE Binance (not testnet — testnet só tem BTC/ETH)
        log.info(f"  📦 HFT: Carregando histórico ({HFT_TIMEFRAME}) para {len(HFT_PAIRS)} pares (LIVE Binance)...")
        try:
            from binance.client import Client as _LiveClient
            _live_client = _LiveClient(api_key, secret_key, testnet=False)
        except Exception as _ce:
            _live_client = client  # fallback
            log.warning(f"  ⚠ HFT: usando client testnet para klines (fallback): {_ce}")

        for _hp in HFT_PAIRS:
            try:
                _kl = _live_client.get_klines(symbol=_hp, interval=HFT_TIMEFRAME, limit=80)
                _eng = get_hft_engine()
                if _eng and _kl:
                    for _k in _kl[:-1]:  # skip last (candle still open)
                        _eng.closes[_hp].append(float(_k[4]))
                        _eng.highs[_hp].append(float(_k[2]))
                        _eng.lows[_hp].append(float(_k[3]))
                        _eng.volumes[_hp].append(float(_k[5]))
                        _eng.opens[_hp].append(float(_k[1]))
                log.info(f"    ✅ {_hp}: {len(_kl)-1} velas fechadas carregadas")
            except Exception as _he:
                log.warning(f"    ⚠ {_hp}: falha no pré-load: {_he}")
        log.info(f"  ✅ HFT pronto — monitorando {len(HFT_PAIRS)} pares em {HFT_TIMEFRAME}")
        log.info(f"  📋 Pares: {', '.join(HFT_PAIRS)}")
        log.info(f"  ⚡ Config: TP={HFT_TP_PCT}% | SL={HFT_SL_PCT}% | Risk={HFT_RISK_PCT}% | Cooldown={HFT_COOLDOWN}s")
        log.info(f"  🛡 Daily Loss Limit: {HFT_DAILY_LOSS}% | Min Sinais: {HFT_MIN_SIGNALS}")

    from binance import ThreadedWebsocketManager

    ws_reconnects = 0
    MAX_WS_RECONNECTS = 20  # reconexões dentro do mesmo processo

    while state['running'] and ws_reconnects < MAX_WS_RECONNECTS:
        try:
            log.info(f"  📡 Conectando WebSocket (tentativa {ws_reconnects+1})...")
            # WebSocket sempre usa Binance LIVE para dados de preço
            # Apenas a execução de ordens usa testnet (via client)
            # WebSocket SEMPRE usa Binance Live (testnet WS não tem todos os pares)
            # Execução de ordens continua usando testnet quando BOT_TESTNET=true
            twm = ThreadedWebsocketManager(api_key=api_key, api_secret=secret_key,
                                           testnet=False)
            twm.start()

            if STRATEGY == 'scalping':
                twm.start_symbol_ticker_socket(callback=on_ticker, symbol=SYMBOL)
            elif STRATEGY == 'hft':
                # HFT: WebSocket em múltiplos pares simultaneamente
                def _make_hft_cb(pair_sym):
                    def _cb(msg):
                        if msg.get('e') == 'kline':
                            k = msg['k']
                            engine = get_hft_engine()
                            if engine and engine.running:
                                engine.on_candle(
                                    pair_sym,
                                    float(k['o']), float(k['h']),
                                    float(k['l']), float(k['c']),
                                    float(k['v']), k.get('x', False)
                                )
                    return _cb
                for _pair in HFT_PAIRS:
                    try:
                        twm.start_kline_socket(
                            callback=_make_hft_cb(_pair),
                            symbol=_pair,
                            interval=HFT_TIMEFRAME
                        )
                        log.info(f"  📡 HFT WebSocket: {_pair} ({HFT_TIMEFRAME})")
                    except Exception as _e:
                        log.warning(f"  ⚠ HFT: falha ao conectar {_pair}: {_e}")
                # Also connect main SYMBOL for compatibility
                if SYMBOL not in HFT_PAIRS:
                    twm.start_kline_socket(callback=on_kline, symbol=SYMBOL, interval=HFT_TIMEFRAME)
            else:
                twm.start_kline_socket(callback=on_kline, symbol=SYMBOL, interval=TIMEFRAME)

            log.info("  ✅ WebSocket conectado — monitorando velas...")
            ws_reconnects_before = ws_reconnects

            # Watchdog loop
            while state['running']:
                time.sleep(2)
                # Check for Telegram /stop command
                import os as _osc
                if _osc.path.exists('/tmp/hft_stop_flag'):
                    try: _osc.remove('/tmp/hft_stop_flag')
                    except: pass
                    log.info("  🛑 Comando /stop recebido via Telegram — encerrando...")
                    state['running'] = False
                    break
                if not twm.is_alive():
                    log.warning("  ⚠️ WebSocket desconectado — reconectando em 5s...")
                    break

            try: twm.stop()
            except: pass

            if not state['running']:
                break  # usuário parou

            # Reconexão
            ws_reconnects += 1
            wait = min(5 * ws_reconnects, 30)  # espera progressiva: 5s, 10s, 15s... máx 30s
            log.info(f"  🔄 Reconectando WebSocket em {wait}s... ({ws_reconnects}/{MAX_WS_RECONNECTS})")
            time.sleep(wait)

        except KeyboardInterrupt:
            break
        except Exception as e:
            ws_reconnects += 1
            log.error(f"  WebSocket erro: {e}")
            time.sleep(10)

    wr = state['wins']/max(1,state['wins']+state['losses'])*100
    log.info(f"\n{'='*62}")
    log.info(f"  Resultado final: PnL ${state['pnl']:+.2f} | "
             f"W:{state['wins']} L:{state['losses']} WR:{wr:.0f}%")
    log.info(f"{'='*62}")
    multi_scanner.stop()
    # Send HFT daily summary on stop
    if STRATEGY == 'hft':
        try:
            eng = get_hft_engine()
            if eng and (eng.daily_wins + eng.daily_losses) > 0:
                eng.send_daily_summary()
        except Exception as _se:
            log.debug(f'HFT summary on stop failed: {_se}')
    notify_stop(SYMBOL, state['pnl'], state['wins'], state['losses'])
    # Limpa PID file ao encerrar (se foi criado)
    pid_file = os.environ.get('BOT_PID_FILE', '')
    if pid_file:
        try:
            if os.path.exists(pid_file): os.remove(pid_file)
        except: pass

if __name__=='__main__':
    MAX_RETRIES = 10   # máximo de tentativas de reconexão
    retry_count = 0
    retry_delay = 15   # segundos entre tentativas (começa em 15s)
    _first_run = True  # só envia notify_start na primeira vez

    while retry_count < MAX_RETRIES:
        try:
            state['running'] = True
            import os as _os
            _os.environ['_BOT_FIRST_RUN'] = '1' if _first_run else '0'
            _first_run = False
            main()
        except SystemExit as e:
            # exit(2) = erro de configuração — não reinicia
            if e.code == 2:
                log.error("Erro de configuração — bot não será reiniciado automaticamente.")
                break
            # exit(1) = erro de conexão — aguarda e tenta novamente
            retry_count += 1
            log.info(f"Tentativa {retry_count}/{MAX_RETRIES} em {retry_delay}s...")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 120)  # backoff exponencial até 2 min
        except KeyboardInterrupt:
            log.info("Interrompido pelo usuário.")
            break
        except Exception as e:
            retry_count += 1
            log.error(f"Erro inesperado (tentativa {retry_count}/{MAX_RETRIES}): {e}")
            if retry_count >= MAX_RETRIES:
                log.error("Máximo de tentativas atingido — encerrando.")
                break
            log.info(f"Reconectando em {retry_delay}s...")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 1.5, 120)
        else:
            if state.get('running') == False:
                log.info("Bot encerrado pelo usuário.")
                break
            break
