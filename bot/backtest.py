#!/usr/bin/env python3
"""
CryptoEdge Pro — Backtesting Engine v1.0
Testa qualquer estratégia no histórico real da Binance e retorna métricas.
"""

import sys, json, os, math
from collections import deque
from datetime import datetime, timezone
from binance.client import Client
from dotenv import load_dotenv

load_dotenv()

# --- Re-use indicator functions from gridbot ----------------------------------
def ema(values, period):
    vals = list(values)
    if not vals: return 0
    if len(vals) < period: return sum(vals)/len(vals)
    k = 2/(period+1); e = vals[0]
    for v in vals[1:]: e = v*k + e*(1-k)
    return e

def rsi(closes, period=14):
    vals = list(closes)[-(period+1):]
    if len(vals) < period+1: return 50
    gains = [max(vals[i]-vals[i-1],0) for i in range(1,len(vals))]
    losses= [max(vals[i-1]-vals[i],0) for i in range(1,len(vals))]
    ag = sum(gains)/period; al = sum(losses)/period
    return 100 if al==0 else 100-(100/(1+ag/al))

def bollinger(closes, period=14, std=2.0):
    vals = list(closes)[-period:]
    if len(vals) < period: return None, None, None
    mid = sum(vals)/len(vals)
    sd  = (sum((v-mid)**2 for v in vals)/len(vals))**0.5
    return mid+std*sd, mid, mid-std*sd

def vwap_calc(closes, volumes, period=20):
    c=list(closes)[-period:]; v=list(volumes)[-period:]
    if not c or not v: return c[-1] if c else 0
    tv=sum(v); return sum(ci*vi for ci,vi in zip(c,v))/tv if tv>0 else c[-1]

def stoch(closes, highs, lows, k=9):
    c=list(closes)[-k:]; h=list(highs)[-k:]; l=list(lows)[-k:]
    if len(c)<k: return 50
    ll=min(l); hh=max(h)
    return (c[-1]-ll)/(hh-ll)*100 if hh!=ll else 50

def macd_calc(closes, fast=12, slow=26, sig=9):
    vals = list(closes)
    if len(vals) < slow+sig: return 0,0,0
    ef = ema(vals[-fast:],fast); es = ema(vals[-slow:],slow)
    ml = ef-es
    ms = [ema(vals[max(0,i-fast):i+1],fast)-ema(vals[max(0,i-slow):i+1],slow)
          for i in range(len(vals)-slow, len(vals))]
    sl = ema(ms[-sig:],sig)
    return ml, sl, ml-sl

def atr_calc(highs, lows, closes, period=14):
    h=list(highs)[-(period+1):]; l=list(lows)[-(period+1):]; c=list(closes)[-(period+1):]
    if len(c)<2: return 0
    trs=[max(h[i]-l[i],abs(h[i]-c[i-1]),abs(l[i]-c[i-1])) for i in range(1,len(c))]
    return sum(trs)/len(trs) if trs else 0

# --- Backtest Engine ----------------------------------------------------------

class Backtester:
    def __init__(self, klines, strategy='trend', config=None):
        self.klines   = klines
        self.strategy = strategy
        self.cfg      = config or {}
        self.capital  = float(self.cfg.get('capital', 300))
        self.initial  = self.capital
        self.position = None
        self.trades   = []
        self.equity   = []   # (timestamp, capital)
        self.closes   = deque(maxlen=200)
        self.highs    = deque(maxlen=200)
        self.lows     = deque(maxlen=200)
        self.vols     = deque(maxlen=200)
        self.prev_macd_hist = 0
        self.opens    = deque(maxlen=200)

    def run(self):
        warmup = max(50, int(self.cfg.get('warmup', 50)))
        for i, k in enumerate(self.klines):
            ts    = k[0]
            opn   = float(k[1]); high=float(k[2]); low=float(k[3])
            close = float(k[4]); vol=float(k[5])
            self.closes.append(close); self.highs.append(high)
            self.lows.append(low);    self.vols.append(vol)

            if i < warmup:
                continue

            # Check SL/TP first
            if self.position:
                pos = self.position
                hit = False
                if pos['side'] == 'BUY':
                    if low <= pos['sl']:
                        self._close(pos['sl'], ts, 'STOP LOSS'); hit=True
                    elif high >= pos['tp']:
                        self._close(pos['tp'], ts, 'TAKE PROFIT'); hit=True
                else:
                    if high >= pos['sl']:
                        self._close(pos['sl'], ts, 'STOP LOSS'); hit=True
                    elif low <= pos['tp']:
                        self._close(pos['tp'], ts, 'TAKE PROFIT'); hit=True
                if hit:
                    self.equity.append((ts, self.capital))
                    continue

            # Strategy signal
            sig = self._signal(close, high, low, vol)
            if sig and not self.position:
                self._open(sig, close, ts)

            self.equity.append((ts, self.capital))

        # Force-close any open position at last price
        if self.position and self.klines:
            lk = self.klines[-1]
            self._close(float(lk[4]), lk[0], 'FIM DO BACKTEST')

        result = self._metrics()
        if self.strategy == 'hft' and result.get('trades', 0) > 0:
            if self.klines:
                candles_per_day = 1440
                days = max(1, len(self.klines) / candles_per_day)
                result['trades_per_day'] = round(result['trades'] / days, 1)
            durations = [t.get('duration_min', 0) for t in self.trades if t.get('duration_min')]
            if durations:
                result['avg_duration_min'] = round(sum(durations) / len(durations), 1)
        return result

    def _signal(self, close, high, low, vol):
        r   = rsi(self.closes)
        a   = atr_calc(self.highs, self.lows, self.closes)
        sl  = max(a * 1.5, close * 0.015)
        tp  = sl * float(self.cfg.get('rr', 2.0))
        qty = self.capital / close * 0.95

        if self.strategy == 'trend':
            fast = int(self.cfg.get('ema_fast', 9))
            slow = int(self.cfg.get('ema_slow', 21))
            ef   = ema(list(self.closes)[-fast:], fast)
            es   = ema(list(self.closes)[-slow:], slow)
            if ef > es*1.001 and r < 65:
                return {'side':'BUY',  'qty':qty,'sl':close-sl,'tp':close+tp}
            if ef < es*0.999 and r > 35:
                return {'side':'SELL', 'qty':qty,'sl':close+sl,'tp':close-tp}

        elif self.strategy == 'macd':
            ml, sl_v, hist = macd_calc(self.closes)
            prev = self.prev_macd_hist
            self.prev_macd_hist = hist
            if prev < 0 and hist > 0 and r < 65:
                return {'side':'BUY',  'qty':qty,'sl':close-sl,'tp':close+tp}
            if prev > 0 and hist < 0 and r > 35:
                return {'side':'SELL', 'qty':qty,'sl':close+sl,'tp':close-tp}

        elif self.strategy == 'breakout':
            lb   = int(self.cfg.get('lookback', 20))
            res  = max(list(self.highs)[-lb:]) if len(self.highs)>=lb else 0
            sup  = min(list(self.lows)[-lb:])  if len(self.lows)>=lb  else 0
            vols = list(self.vols)
            av   = sum(vols[-10:])/10 if len(vols)>=10 else 0
            if close > res*1.003 and (vol>av*1.2 if av else True):
                return {'side':'BUY',  'qty':qty,'sl':close-sl,'tp':close+tp}
            if close < sup*0.997 and (vol>av*1.2 if av else True):
                return {'side':'SELL', 'qty':qty,'sl':close+sl,'tp':close-tp}

        elif self.strategy == 'scalping':
            rb  = float(self.cfg.get('rsi_buy',  30))
            rs  = float(self.cfg.get('rsi_sell', 70))
            sl_p= float(self.cfg.get('sl_pct',   1.0)) / 100
            tp_p= float(self.cfg.get('tp_pct',   1.5)) / 100
            if r < rb:
                return {'side':'BUY',  'qty':qty,'sl':close*(1-sl_p),'tp':close*(1+tp_p)}
            if r > rs:
                return {'side':'SELL', 'qty':qty,'sl':close*(1+sl_p),'tp':close*(1-tp_p)}

        elif self.strategy == 'pattern':
            sys.path.insert(0, os.path.dirname(__file__))
            from patterns import Candle, run_all
            candles = [Candle(open=float(self.klines[max(0,i-1)][1]),
                              high=float(k[2]),low=float(k[3]),
                              close=float(k[4]),volume=float(k[5]))
                       for i,k in enumerate(self.klines) if float(k[4]) in list(self.closes)]
            if len(candles) < 5: return None
            min_conf = float(self.cfg.get('min_conf', 0.65))
            pats, pred = run_all(candles[-30:], 'neutral')
            conf = pred.get('confidence', 0)
            if conf < min_conf: return None
            if pred.get('direction') == 'up' and r < 70:
                return {'side':'BUY',  'qty':qty,'sl':close-sl,'tp':close+tp}
            if pred.get('direction') == 'down' and r > 30:
                return {'side':'SELL', 'qty':qty,'sl':close+sl,'tp':close-tp}

        elif self.strategy == 'hft':
            # Replica as 9 estratégias do HFT engine
            tp_pct = float(self.cfg.get('hft_tp_pct', 0.35)) / 100
            sl_pct = float(self.cfg.get('hft_sl_pct', 0.18)) / 100
            min_sig = int(self.cfg.get('hft_min_signals', 2))
            buys = 0; sells = 0
            # 1. EMA micro
            e3=ema(list(self.closes)[-3:],3); e8=ema(list(self.closes)[-8:],8); e21=ema(list(self.closes)[-21:],21)
            if e3>e8*1.0003 and e8>e21: buys+=1
            elif e3<e8*0.9997 and e8<e21: sells+=1
            # 2. RSI
            if r<28: buys+=2
            elif r<32: buys+=1
            elif r>72: sells+=2
            elif r>68: sells+=1
            # 3. Bollinger
            bb_u,bb_m,bb_l = bollinger(self.closes)
            if bb_l and close<bb_l: buys+=1
            elif bb_u and close>bb_u: sells+=1
            # 4. VWAP
            vw=vwap_calc(self.closes,self.vols)
            dev=(close-vw)/vw*100 if vw else 0
            if dev<-0.4: buys+=1
            elif dev>0.4: sells+=1
            # 5. Volume spike
            vls=list(self.vols); av=sum(vls[-6:-1])/5 if len(vls)>=6 else 0
            if av>0 and vol>av*1.8:
                if close>list(self.closes)[-2]: buys+=1
                else: sells+=1
            # 6. Stochastic
            sk=stoch(self.closes,self.highs,self.lows)
            if sk<20: buys+=1
            elif sk>80: sells+=1
            # Decision
            if buys>=min_sig and buys>sells:
                return {'side':'BUY','qty':qty,'sl':close*(1-sl_pct),'tp':close*(1+tp_pct)}
            if sells>=min_sig and sells>buys:
                return {'side':'SELL','qty':qty,'sl':close*(1+sl_pct),'tp':close*(1-tp_pct)}
        return None

    def _open(self, sig, price, ts):
        self.position = {
            'side':  sig['side'],
            'entry': price,
            'qty':   sig['qty'],
            'sl':    sig['sl'],
            'tp':    sig['tp'],
            'open_ts': ts,
        }

    def _close(self, price, ts, reason):
        pos = self.position
        if pos['side'] == 'BUY':
            pnl = (price - pos['entry']) * pos['qty']
        else:
            pnl = (pos['entry'] - price) * pos['qty']
        self.capital += pnl
        self.trades.append({
            'side':    pos['side'],
            'entry':   pos['entry'],
            'exit':    price,
            'qty':     pos['qty'],
            'pnl':     round(pnl, 4),
            'reason':  reason,
            'open_ts': pos['open_ts'],
            'close_ts':ts,
        })
        self.position = None

    def _metrics(self):
        trades  = self.trades
        n       = len(trades)
        if n == 0:
            return {'trades':0,'win_rate':0,'total_pnl':0,'roi':0,
                    'max_drawdown':0,'sharpe':0,'avg_win':0,'avg_loss':0,
                    'profit_factor':0,'equity':self.equity,'trade_list':[]}

        wins    = [t for t in trades if t['pnl'] > 0]
        losses  = [t for t in trades if t['pnl'] <= 0]
        pnls    = [t['pnl'] for t in trades]
        total   = sum(pnls)
        wr      = len(wins)/n*100

        # Max drawdown
        peak = self.initial; dd = 0
        cap  = self.initial
        for t in trades:
            cap += t['pnl']
            if cap > peak: peak = cap
            d = (peak-cap)/peak*100
            if d > dd: dd = d

        # Sharpe (simplified)
        if len(pnls) > 1:
            mean  = sum(pnls)/len(pnls)
            var   = sum((p-mean)**2 for p in pnls)/len(pnls)
            std   = math.sqrt(var) if var > 0 else 1e-9
            sharpe= (mean/std) * math.sqrt(252) if std else 0
        else:
            sharpe = 0

        avg_win  = sum(t['pnl'] for t in wins)/len(wins)   if wins   else 0
        avg_loss = sum(t['pnl'] for t in losses)/len(losses) if losses else 0
        gross_p  = sum(t['pnl'] for t in wins)
        gross_l  = abs(sum(t['pnl'] for t in losses))
        pf       = gross_p/gross_l if gross_l > 0 else float('inf')

        # Daily equity for chart
        daily = {}
        for ts, cap in self.equity:
            day = datetime.fromtimestamp(ts/1000, tz=timezone.utc).strftime('%Y-%m-%d')
            daily[day] = cap
        equity_daily = [{'date': d, 'capital': round(c, 2)} for d, c in sorted(daily.items())]

        return {
            'trades':        n,
            'wins':          len(wins),
            'losses':        len(losses),
            'win_rate':      round(wr, 1),
            'total_pnl':     round(total, 2),
            'roi':           round(total/self.initial*100, 2),
            'max_drawdown':  round(dd, 2),
            'sharpe':        round(sharpe, 2),
            'avg_win':       round(avg_win, 2),
            'avg_loss':      round(avg_loss, 2),
            'profit_factor': round(pf, 2) if pf != float('inf') else 999,
            'final_capital': round(self.capital, 2),
            'equity_daily':  equity_daily,
            'trade_list':    [
                { 'side':t['side'],'entry':round(t['entry'],2),'exit':round(t['exit'],2),
                  'pnl':t['pnl'],'reason':t['reason'],
                  'date': datetime.fromtimestamp(t['open_ts']/1000,tz=timezone.utc).strftime('%d/%m %H:%M')
                } for t in trades[-50:]  # last 50 trades
            ]
        }


# --- CLI entry point (used by server.js via child_process) --------------------


# --- Walk-Forward Analysis -----------------------------------------------------
def walk_forward(klines, strategy='trend', config=None, folds=4):
    n = len(klines); fold_size = n // (folds + 1); results = []
    for i in range(folds):
        test_klines = klines[fold_size*(i+1):fold_size*(i+2)]
        if len(test_klines) < 10: continue
        bt = Backtester(test_klines, strategy=strategy, config=config); m = bt.run()
        results.append({'fold':i+1,'trades':m.get('trades',0),'win_rate':m.get('win_rate',0),
                        'pnl':m.get('total_pnl',0),'sharpe':m.get('sharpe',0),'roi':m.get('roi',0)})
    if not results: return {'folds':[],'consistent':False,'avg_wr':0,'avg_sharpe':0,'avg_roi':0,'verdict':'Dados insuficientes'}
    pos = sum(1 for r in results if r['pnl'] >= 0)
    consistent = pos == len(results)
    return {'folds':results,'consistent':consistent,'positive_folds':pos,'total_folds':len(results),
            'avg_wr':round(sum(r['win_rate'] for r in results)/len(results),1),
            'avg_sharpe':round(sum(r['sharpe'] for r in results)/len(results),2),
            'avg_roi':round(sum(r['roi'] for r in results)/len(results),2),
            'verdict':'Consistente ✅' if consistent else
                      f'Parcialmente consistente ({pos}/{len(results)} folds) ⚠️' if pos > len(results)//2
                      else 'Inconsistente ❌ — possível overfitting'}

def optimize_params(klines, strategy='trend', config=None):
    cfg = config or {}
    if strategy == 'trend':
        grid = [{'ema_fast':f,'ema_slow':s,'rr':cfg.get('rr',2)} for f in [5,9,14] for s in [21,34,50] if f < s]
    elif strategy == 'macd':
        grid = [{'macd_fast':f,'macd_slow':s,'macd_signal':g,'rr':cfg.get('rr',2)} for f in [8,12] for s in [21,26] for g in [7,9] if f < s]
    else:
        grid = [{'rr':r} for r in [1.5,2.0,2.5,3.0]]
    results = []
    for params in grid:
        try:
            merged = {**cfg, **params}
            bt = Backtester(klines, strategy=strategy, config=merged); m = bt.run()
            if m.get('trades',0) >= 3: results.append({'params':params, **m})
        except: continue
    results.sort(key=lambda x: x.get('sharpe',0), reverse=True)
    return results[:5]

if __name__ == '__main__':
    import sys, json
    from binance.client import Client
    from dotenv import load_dotenv
    load_dotenv()
    params = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    mode   = next((a.split('=',1)[1] for a in sys.argv[2:] if a.startswith('--mode=')), '')
    cl = Client(os.environ.get('BINANCE_API_KEY',''), os.environ.get('BINANCE_SECRET_KEY',''), testnet=True)
    symbol    = params.get('symbol','BTCUSDT')
    timeframe = params.get('timeframe','15m')
    limit     = int(params.get('limit',500))
    strategy  = params.get('strategy','trend')
    klines    = cl.get_klines(symbol=symbol, interval=timeframe, limit=limit)
    if mode == 'walkforward':
        print(json.dumps(walk_forward(klines, strategy=strategy, config=params, folds=int(params.get('folds',4)))))
    elif mode == 'optimize':
        print(json.dumps(optimize_params(klines, strategy=strategy, config=params)))
    else:
        bt = Backtester(klines, strategy=strategy, config=params)
        print(json.dumps(bt.run()))
