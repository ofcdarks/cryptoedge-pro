#!/usr/bin/env python3
"""
CryptoEdge Pro — Bot v4.0 (Pattern Engine)
Opera vela a vela identificando padrões históricos e prevendo o próximo movimento.
"""

import os, time, json, logging, signal, sys, math
from decimal import Decimal
from collections import deque
from binance.client import Client
from binance.enums import *
# python-binance v1+ uses REST polling — no BinanceSocketManager needed
from dotenv import load_dotenv
from patterns import Candle, PatternResult, Signal, run_all
from telegram_notify import notify_start, notify_entry, notify_exit, notify_stop_loss_global, notify_error

load_dotenv()
load_dotenv('.bot.env', override=True)  # frontend config takes priority
# Normalize symbol after loading .bot.env
SYMBOL = os.environ.get('BOT_SYMBOL', os.environ.get('SYMBOL', 'BTCUSDT')).upper().replace('/','').replace('-','')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('gridbot.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger('CryptoEdge')

# ── Config ─────────────────────────────────────────────────────────────────────
API_KEY    = os.environ.get('BINANCE_API_KEY',   '')
SECRET_KEY = os.environ.get('BINANCE_SECRET_KEY','')
TESTNET    = os.environ.get('BOT_TESTNET','true').lower() == 'true'

SYMBOL     = os.environ.get('BOT_SYMBOL', os.environ.get('SYMBOL', 'BTCUSDT')).upper().replace('/','').replace('-','')
CAPITAL    = float(os.environ.get('BOT_CAPITAL',    '300'))
STOP_LOSS  = float(os.environ.get('BOT_STOP_LOSS',  '0'))
TIMEFRAME  = os.environ.get('BOT_TIMEFRAME', '15m')
STRATEGY   = os.environ.get('BOT_STRATEGY', 'pattern')

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

# ─────────────────────────────────────────────────────────────────────────────
# INDICADORES
# ─────────────────────────────────────────────────────────────────────────────

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

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def get_sym_info():
    info = client.get_symbol_info(SYMBOL)
    lot  = next(f for f in info['filters'] if f['filterType']=='LOT_SIZE')
    return {'min_qty': float(lot['minQty']), 'step': float(lot['stepSize'])}

def round_step(v, step):
    prec = len(str(step).rstrip('0').split('.')[-1]) if '.' in str(step) else 0
    return round(float(Decimal(str(v))//Decimal(str(step))*Decimal(str(step))), prec)

def place_order(side, qty, price=None, otype=ORDER_TYPE_MARKET):
    if TESTNET:
        log.info(f"  [TESTNET] {side} {qty:.6f} @ {'MARKET' if not price else f'${price:,.2f}'}")
        return {'orderId': 0, 'side': side, 'executedQty': qty}
    p = dict(symbol=SYMBOL, side=side, type=otype, quantity=qty)
    if price and otype==ORDER_TYPE_LIMIT:
        p['timeInForce']=TIME_IN_FORCE_GTC; p['price']=f'{price:.2f}'
    return client.create_order(**p)

def open_long(price, qty, sl, tp, reason=''):
    log.info(f"  🟢 LONG {qty:.6f} @ ${price:,.2f} | SL ${sl:,.2f} | TP ${tp:,.2f} | {reason}")
    place_order(SIDE_BUY, qty)
    state['position'] = {'side':'BUY','entry':price,'qty':qty,'sl':sl,'tp':tp}
    notify_entry('BUY', SYMBOL, price, qty, sl, tp, reason)

def open_short(price, qty, sl, tp, reason=''):
    log.info(f"  🔴 SHORT {qty:.6f} @ ${price:,.2f} | SL ${sl:,.2f} | TP ${tp:,.2f} | {reason}")
    place_order(SIDE_SELL, qty)
    state['position'] = {'side':'SELL','entry':price,'qty':qty,'sl':sl,'tp':tp}
    notify_entry('SELL', SYMBOL, price, qty, sl, tp, reason)

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
    notify_exit(pos['side'], SYMBOL, pos['entry'], current_price, pnl, reason)
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

# ─────────────────────────────────────────────────────────────────────────────
# STRATEGY: PATTERN ENGINE (principal)
# ─────────────────────────────────────────────────────────────────────────────

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

    log.info(f"\n  ┌─ PADRÕES DETECTADOS ({len(patterns)}) {'─'*35}")
    if patterns:
        for p in patterns[:5]:  # top 5
            log.info(f"  │  {p}")
    else:
        log.info(f"  │  Nenhum padrão identificado nesta vela")

    dir_   = prediction.get('direction','neutral')
    conf_  = prediction.get('confidence', 0)
    tgt_   = prediction.get('target_pct', 0)
    score_ = prediction.get('score', 0)

    log.info(f"  ├─ PREDIÇÃO PRÓXIMO MOVIMENTO:")
    log.info(f"  │  Direção: {dir_.upper()} | Confiança: {conf_:.0%} | Alvo: {tgt_:+.1f}%")
    for r in prediction.get('reasoning', [])[:4]:
        log.info(f"  │  {r}")
    log.info(f"  └{'─'*50}")

    # SL/TP dinâmico baseado no ATR
    atr_val   = atr(state['raw_highs'], state['raw_lows'], state['raw_closes'])
    sl_dist   = max(atr_val * SL_ATR_MULT, close * 0.01)
    tp_dist   = sl_dist * TP_RR
    info      = get_sym_info()
    qty       = round_step(CAPITAL / close * 0.95, info['step'])

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
        top_pat = patterns[0]
        open_long(close, qty,
                  sl=close - sl_dist,
                  tp=close + tp_dist,
                  reason=f"{top_pat.name} | RSI {rsi_val:.0f} | conf {conf_:.0%}")

    elif high_conf_bear and vol_ok and rsi_ok_short:
        top_pat = patterns[0]
        open_short(close, qty,
                   sl=close + sl_dist,
                   tp=close - tp_dist,
                   reason=f"{top_pat.name} | RSI {rsi_val:.0f} | conf {conf_:.0%}")


# ─────────────────────────────────────────────────────────────────────────────
# STRATEGIES: GRID, DCA, SCALP, TREND, MACD (mantidas do v3)
# ─────────────────────────────────────────────────────────────────────────────

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
    info=get_sym_info(); qty=round_step(CAPITAL/price,info['step'])
    if qty<info['min_qty']: return
    if r<SCALP_RSI_BUY:
        sl=price*(1-SCALP_SL_PCT/100); tp=price*(1+SCALP_TP_PCT/100)
        open_long(price,qty,sl,tp,f"RSI {r:.0f}")
    elif r>SCALP_RSI_SELL:
        sl=price*(1+SCALP_SL_PCT/100); tp=price*(1-SCALP_TP_PCT/100)
        open_short(price,qty,sl,tp,f"RSI {r:.0f}")

def trend_on_candle(close):
    if len(state['raw_closes'])<TREND_SLOW+5: return
    closes=list(state['raw_closes'])
    ef=ema(closes[-TREND_FAST:],TREND_FAST); es=ema(closes[-TREND_SLOW:],TREND_SLOW)
    r=rsi(state['raw_closes']); a=atr(state['raw_highs'],state['raw_lows'],state['raw_closes'])
    sl_d=max(a*1.5,close*0.02); tp_d=sl_d*2
    check_sl_tp(close)
    if state['position']: return
    info=get_sym_info(); qty=round_step(CAPITAL/close*0.95,info['step'])
    if ef>es*1.001 and r<65:
        open_long(close,qty,close-sl_d,close+tp_d,f"EMA{TREND_FAST}>{TREND_SLOW} RSI{r:.0f}")
    elif ef<es*0.999 and r>35:
        open_short(close,qty,close+sl_d,close-tp_d,f"EMA{TREND_FAST}<{TREND_SLOW} RSI{r:.0f}")

def macd_on_candle(close):
    if len(state['raw_closes'])<MACD_SLOW+MACD_SIGNAL+5: return
    ml,sl,hist=macd(state['raw_closes'],MACD_FAST,MACD_SLOW,MACD_SIGNAL)
    r=rsi(state['raw_closes']); a=atr(state['raw_highs'],state['raw_lows'],state['raw_closes'])
    sl_d=max(a*1.5,close*0.015); prev=state['macd_prev_hist']
    check_sl_tp(close)
    info=get_sym_info(); qty=round_step(CAPITAL/close*0.95,info['step'])
    if not state['position']:
        if prev<0 and hist>0 and r<65:
            open_long(close,qty,close-sl_d,close+sl_d*2,f"MACD cross↑ RSI{r:.0f}")
        elif prev>0 and hist<0 and r>35:
            open_short(close,qty,close+sl_d,close-sl_d*2,f"MACD cross↓ RSI{r:.0f}")
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
    info=get_sym_info(); qty=round_step(CAPITAL/close*0.95,info['step'])
    vol_ok=last_v>avg_v*1.2 if avg_v else True
    if close>res*(1+0.003) and vol_ok:
        open_long(close,qty,close-sl_d,close+sl_d*2,f"Break resistência ${res:,.0f}")
    elif close<sup*(1-0.003) and vol_ok:
        open_short(close,qty,close+sl_d,close-sl_d*2,f"Break suporte ${sup:,.0f}")

# ─────────────────────────────────────────────────────────────────────────────
# WebSocket Handlers
# ─────────────────────────────────────────────────────────────────────────────

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
    if state['position']:    check_sl_tp(close)
    if STOP_LOSS>0 and close<=STOP_LOSS:
        log.warning(f"  ⛔ Stop global ${close:,.2f}!")
        notify_stop_loss_global(SYMBOL, close)
        try: client.cancel_open_orders(symbol=SYMBOL)
        except: pass
        close_position(close,'STOP GLOBAL')
        state['running']=False; return
    if not is_close: return

    # ── VELA FECHADA ───────────────────────────────────────────────
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

    log.info(f"\n{'═'*62}")
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


def on_ticker(msg):
    if not state['running']: return
    price = float(msg.get('c',0))
    if price and STRATEGY=='scalping': scalping_on_tick(price)

# ─────────────────────────────────────────────────────────────────────────────
# Warm-up
# ─────────────────────────────────────────────────────────────────────────────

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

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    global client
    # Escreve PID file para que o servidor Node possa rastrear este processo
    pid_file = os.environ.get('BOT_PID_FILE', '/data/bot.pid')
    try:
        os.makedirs(os.path.dirname(pid_file), exist_ok=True)
        with open(pid_file, 'w') as f:
            f.write(str(os.getpid()))
        log.info(f"  PID {os.getpid()} salvo em {pid_file}")
    except Exception as e:
        log.warning(f"  Não foi possível salvar PID: {e}")

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

    log.info(f"\n{'═'*62}")
    log.info(f"  🚀 CryptoEdge Pro — {STRATEGY.upper()}")
    log.info(f"  Par: {SYMBOL} | Capital: ${CAPITAL} | Testnet: {TESTNET}")
    notify_start(SYMBOL, STRATEGY, CAPITAL, TESTNET)
    log.info(f"  Timeframe: {TIMEFRAME} | Stop global: ${STOP_LOSS:,.0f}")
    if STRATEGY in ('pattern','auto'):
        log.info(f"  Pattern Engine: conf≥{MIN_CONFIDENCE:.0%} | "
                 f"SL={SL_ATR_MULT}×ATR | TP={TP_RR}×SL | Volume: {REQUIRE_VOLUME}")
    log.info(f"{'═'*62}\n")

    warm_up()
    if STRATEGY=='grid': grid_init()

    from binance import ThreadedWebsocketManager

    ws_reconnects = 0
    MAX_WS_RECONNECTS = 20  # reconexões dentro do mesmo processo

    while state['running'] and ws_reconnects < MAX_WS_RECONNECTS:
        try:
            log.info(f"  📡 Conectando WebSocket (tentativa {ws_reconnects+1})...")
            twm = ThreadedWebsocketManager(api_key=api_key, api_secret=secret_key,
                                           testnet=TESTNET)
            twm.start()

            if STRATEGY == 'scalping':
                twm.start_symbol_ticker_socket(callback=on_ticker, symbol=SYMBOL)
            else:
                twm.start_kline_socket(callback=on_kline, symbol=SYMBOL, interval=TIMEFRAME)

            log.info("  ✅ WebSocket conectado — monitorando velas...")
            ws_reconnects_before = ws_reconnects

            # Watchdog loop
            while state['running']:
                time.sleep(2)
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
    log.info(f"\n{'═'*62}")
    log.info(f"  Resultado final: PnL ${state['pnl']:+.2f} | "
             f"W:{state['wins']} L:{state['losses']} WR:{wr:.0f}%")
    log.info(f"{'═'*62}")
    # Limpa PID file ao encerrar
    try:
        pid_file = os.environ.get('BOT_PID_FILE', '/data/bot.pid')
        if os.path.exists(pid_file):
            os.remove(pid_file)
    except: pass

if __name__=='__main__':
    MAX_RETRIES = 10   # máximo de tentativas de reconexão
    retry_count = 0
    retry_delay = 15   # segundos entre tentativas (começa em 15s)

    while retry_count < MAX_RETRIES:
        try:
            state['running'] = True
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
