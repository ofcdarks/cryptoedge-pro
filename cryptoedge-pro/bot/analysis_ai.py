#!/usr/bin/env python3
"""
CryptoEdge Pro — Analysis AI Engine
Análise completa: Padrões Harmônicos, SMC, Order Blocks, FVG,
Análise Técnica com 40+ indicadores.
"""
import sys, json, os, math
from binance.client import Client
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))
from patterns import Candle, run_all

client = Client(
    os.environ.get('BINANCE_API_KEY',''),
    os.environ.get('BINANCE_SECRET_KEY',''),
    testnet=False
)

# ── Indicators ────────────────────────────────────────────────────────────────
def ema(v, p):
    if not v: return 0
    k=2/(p+1); e=v[0]
    for x in v[1:]: e=x*k+e*(1-k)
    return e

def sma(v, p):
    return sum(v[-p:])/p if len(v)>=p else sum(v)/len(v) if v else 0

def rsi(closes, p=14):
    v=closes[-(p+1):]
    if len(v)<p+1: return 50
    g=[max(v[i]-v[i-1],0) for i in range(1,len(v))]
    l=[max(v[i-1]-v[i],0) for i in range(1,len(v))]
    ag=sum(g)/p; al=sum(l)/p
    return 100 if al==0 else 100-(100/(1+ag/al))

def macd(closes, f=12, s=26, sig=9):
    if len(closes)<s+sig: return 0,0,0
    ef=ema(closes[-f:],f); es=ema(closes[-s:],s); ml=ef-es
    ms=[ema(closes[max(0,i-f):i+1],f)-ema(closes[max(0,i-s):i+1],s)
        for i in range(len(closes)-s,len(closes))]
    sl=ema(ms[-sig:],sig)
    return ml,sl,ml-sl

def stoch_rsi(closes, p=14):
    r=[rsi(closes[max(0,i-p):i+1],14) for i in range(p,len(closes))]
    if not r: return 50,50
    mn=min(r[-p:]); mx=max(r[-p:])
    k=((r[-1]-mn)/(mx-mn)*100) if mx!=mn else 50
    d=sma([k],3)
    return round(k,1),round(d,1)

def bollinger(closes, p=20, mult=2):
    v=closes[-p:]
    if len(v)<p: return 0,0,0
    m=sum(v)/p; s=math.sqrt(sum((x-m)**2 for x in v)/p)
    return round(m+mult*s,2), round(m,2), round(m-mult*s,2)

def atr(highs, lows, closes, p=14):
    h=highs[-(p+1):]; l=lows[-(p+1):]; c=closes[-(p+1):]
    if len(c)<2: return 0
    trs=[max(h[i]-l[i],abs(h[i]-c[i-1]),abs(l[i]-c[i-1])) for i in range(1,len(c))]
    return sum(trs)/len(trs) if trs else 0

def adx(highs, lows, closes, p=14):
    if len(closes)<p+2: return 0
    h=highs; l=lows; c=closes
    dm_p=[]; dm_n=[]; tr_l=[]
    for i in range(1,len(c)):
        up=h[i]-h[i-1]; dn=l[i-1]-l[i]
        dm_p.append(up if up>dn and up>0 else 0)
        dm_n.append(dn if dn>up and dn>0 else 0)
        tr_l.append(max(h[i]-l[i],abs(h[i]-c[i-1]),abs(l[i]-c[i-1])))
    atr_v=sum(tr_l[-p:])/p; dmp=sum(dm_p[-p:])/p; dmn=sum(dm_n[-p:])/p
    if atr_v==0: return 0
    pdi=100*dmp/atr_v; ndi=100*dmn/atr_v
    dx=100*abs(pdi-ndi)/(pdi+ndi) if pdi+ndi else 0
    return round(dx,1)

def williams_r(highs, lows, closes, p=14):
    h=max(highs[-p:]); l=min(lows[-p:])
    if h==l: return -50
    return round((h-closes[-1])/(h-l)*-100,1)

def cci(highs, lows, closes, p=20):
    tp=[(highs[i]+lows[i]+closes[i])/3 for i in range(len(closes))]
    tp_p=tp[-p:]
    m=sum(tp_p)/p
    md=sum(abs(x-m) for x in tp_p)/p
    return round((tp[-1]-m)/(0.015*md),1) if md else 0

def vwap(highs, lows, closes, volumes):
    tv=[((highs[i]+lows[i]+closes[i])/3)*volumes[i] for i in range(len(closes))]
    sv=sum(volumes[-20:]); stv=sum(tv[-20:])
    return round(stv/sv,2) if sv else closes[-1]

# ── Order Blocks ──────────────────────────────────────────────────────────────
def find_order_blocks(candles, lookback=30):
    blocks=[]
    c=candles[-lookback:]
    for i in range(2, len(c)-1):
        # Bearish OB: last bullish candle before big bearish move
        if c[i].is_bullish and c[i+1].is_bearish and c[i+1].body > c[i].body*1.5:
            move_pct=abs(c[i+1].close-c[i+1].open)/c[i+1].open*100
            blocks.append({
                'type': 'bearish', 'price': round((c[i].high+c[i].low)/2,2),
                'high': c[i].high, 'low': c[i].low,
                'strength': round(move_pct,2),
                'label': f'Bearish OB @ ${c[i].high:,.2f}'
            })
        # Bullish OB: last bearish candle before big bullish move
        elif c[i].is_bearish and c[i+1].is_bullish and c[i+1].body > c[i].body*1.5:
            move_pct=abs(c[i+1].close-c[i+1].open)/c[i+1].open*100
            blocks.append({
                'type': 'bullish', 'price': round((c[i].high+c[i].low)/2,2),
                'high': c[i].high, 'low': c[i].low,
                'strength': round(move_pct,2),
                'label': f'Bullish OB @ ${c[i].low:,.2f}'
            })
    return sorted(blocks, key=lambda x: x['strength'], reverse=True)[:6]

# ── Fair Value Gaps ───────────────────────────────────────────────────────────
def find_fvg(candles, lookback=30):
    gaps=[]
    c=candles[-lookback:]
    for i in range(1, len(c)-1):
        # Bullish FVG: gap between low[i-1] and high[i+1] going up
        if c[i+1].low > c[i-1].high:
            size_pct=(c[i+1].low-c[i-1].high)/c[i-1].high*100
            if size_pct>0.1:
                gaps.append({'type':'bullish','top':c[i+1].low,'bottom':c[i-1].high,
                              'size_pct':round(size_pct,2),'label':'Bullish FVG'})
        # Bearish FVG
        elif c[i+1].high < c[i-1].low:
            size_pct=(c[i-1].low-c[i+1].high)/c[i-1].low*100
            if size_pct>0.1:
                gaps.append({'type':'bearish','top':c[i-1].low,'bottom':c[i+1].high,
                              'size_pct':round(size_pct,2),'label':'Bearish FVG'})
    return gaps[-4:]

# ── Harmonic Patterns ─────────────────────────────────────────────────────────
def find_harmonics(closes, highs, lows, lookback=50):
    patterns=[]
    c=closes[-lookback:]; h=highs[-lookback:]; l=lows[-lookback:]
    if len(c)<5: return patterns

    # Find swing points
    swings=[]
    for i in range(2,len(c)-2):
        if h[i]>h[i-1] and h[i]>h[i-2] and h[i]>h[i+1] and h[i]>h[i+2]:
            swings.append(('H',i,h[i]))
        elif l[i]<l[i-1] and l[i]<l[i-2] and l[i]<l[i+1] and l[i]<l[i+2]:
            swings.append(('L',i,l[i]))

    if len(swings)<5: return patterns

    # Check last 5 swing points for harmonic ratios
    def ratio(a,b,c,d): return abs(b-c)/abs(a-c) if abs(a-c)>0 else 0

    defs={
        'Gartley':  {'XB':(0.618,0.618),'AC':(0.382,0.886),'BD':(1.13,1.618),'XD':(0.786,0.786)},
        'Bat':      {'XB':(0.382,0.5),  'AC':(0.382,0.886),'BD':(1.618,2.618),'XD':(0.886,0.886)},
        'Butterfly':{'XB':(0.786,0.786),'AC':(0.382,0.886),'BD':(1.618,2.618),'XD':(1.27,1.618)},
        'Crab':     {'XB':(0.382,0.618),'AC':(0.382,0.886),'BD':(2.618,3.618),'XD':(1.618,1.618)},
        'Cypher':   {'XB':(0.382,0.618),'AC':(1.13,1.414), 'BD':(1.272,2.0),  'XD':(0.786,0.786)},
    }
    tol=0.08

    for i in range(len(swings)-4):
        pts=[swings[i+j] for j in range(5)]
        X,A,B,C,D=pts
        xb=abs(B[2]-X[2])/abs(A[2]-X[2]) if abs(A[2]-X[2])>0 else 0
        ac=abs(C[2]-A[2])/abs(B[2]-A[2]) if abs(B[2]-A[2])>0 else 0
        bd=abs(D[2]-B[2])/abs(C[2]-B[2]) if abs(C[2]-B[2])>0 else 0
        xd=abs(D[2]-X[2])/abs(A[2]-X[2]) if abs(A[2]-X[2])>0 else 0

        for name,rules in defs.items():
            score=0
            checks={
                'XB': (xb,rules['XB']),
                'AC': (ac,rules['AC']),
                'BD': (bd,rules['BD']),
                'XD': (xd,rules['XD']),
            }
            matched={}
            for k,(val,(lo,hi)) in checks.items():
                ok=lo*(1-tol)<=val<=hi*(1+tol)
                matched[k]=round(val,3)
                if ok: score+=1

            if score>=3:
                bull=D[0]=='L'
                conf=score/4
                patterns.append({
                    'name':name, 'bullish':bull,
                    'bias':'Alta' if bull else 'Baixa',
                    'confidence':round(conf,2),
                    'formation':round(score/4*100),
                    'ratios':matched,
                    'prz':round(D[2],2),
                    'stop':round(D[2]*(1.02 if not bull else 0.98),2),
                    'targets':[round(D[2]*(0.382 if bull else 1.618),2),
                               round(D[2]*(0.618 if bull else 1.272),2)],
                })
    return sorted(patterns, key=lambda x: x['confidence'], reverse=True)[:4]

# ── SMC Analysis ──────────────────────────────────────────────────────────────
def smc_analysis(candles, closes, volumes):
    if len(candles)<20: return {}
    # Detect market structure
    highs=[c.high for c in candles]; lows=[c.low for c in candles]
    # Higher highs / higher lows = bullish structure
    hh = highs[-1] > highs[-6] if len(highs)>=6 else False
    hl = lows[-1]  > lows[-6]  if len(lows)>=6  else False
    lh = highs[-1] < highs[-6] if len(highs)>=6 else False
    ll = lows[-1]  < lows[-6]  if len(lows)>=6  else False

    if hh and hl:   structure='Bullish (HH/HL)'
    elif lh and ll: structure='Bearish (LH/LL)'
    else:           structure='Ranging/Consolidation'

    # Volume analysis
    avg_vol=sum(volumes[-20:])/20 if len(volumes)>=20 else 0
    last_vol=volumes[-1] if volumes else 0
    vol_ratio=last_vol/avg_vol if avg_vol else 1

    # Bias
    bias='ALTISTA' if hh and hl else 'BAIXISTA' if lh and ll else 'NEUTRO'
    return {
        'structure': structure,
        'bias':      bias,
        'vol_ratio': round(vol_ratio,2),
        'hh': hh, 'hl': hl, 'lh': lh, 'll': ll,
        'high_vol': vol_ratio > 1.3,
    }

# ── Technical Summary (44 indicators) ────────────────────────────────────────
def tech_summary(closes, highs, lows, volumes, current):
    signals = []

    def sig(name, val, buy_cond, sell_cond, val_str=''):
        if buy_cond:   signals.append(('BUY',   name, val_str or str(round(val,2))))
        elif sell_cond:signals.append(('SELL',  name, val_str or str(round(val,2))))
        else:          signals.append(('NEUTRAL',name, val_str or str(round(val,2))))

    r=rsi(closes)
    sig('RSI(14)', r, r<30, r>70)
    sig('RSI(9)',  rsi(closes,9), rsi(closes,9)<30, rsi(closes,9)>70)
    ml,sl,mh=macd(closes)
    sig('MACD',    mh, mh>0 and ml>0, mh<0 and ml<0)
    k,d=stoch_rsi(closes)
    sig('Stoch RSI K', k, k<20, k>80)
    sig('Stoch RSI D', d, d<20, d>80)
    bu,bm,bl=bollinger(closes)
    sig('BB Upper', bu, False, current>=bu, f'${bu:,.2f}')
    sig('BB Lower', bl, current<=bl, False, f'${bl:,.2f}')
    sig('BB Middle', bm, current>bm, current<bm, f'${bm:,.2f}')
    a=atr(highs,lows,closes)
    sig('ATR(14)', a, False, False, f'${a:,.2f}')
    adx_v=adx(highs,lows,closes)
    sig('ADX(14)', adx_v, adx_v>25 and closes[-1]>closes[-5], adx_v>25 and closes[-1]<closes[-5])
    wr=williams_r(highs,lows,closes)
    sig('Williams %R', wr, wr<-80, wr>-20)
    cci_v=cci(highs,lows,closes)
    sig('CCI(20)', cci_v, cci_v<-100, cci_v>100)
    vw=vwap(highs,lows,closes,volumes)
    sig('VWAP', vw, current>vw, current<vw, f'${vw:,.2f}')
    for p in [9,21,50,100,200]:
        s=sma(closes,p)
        sig(f'SMA({p})', s, current>s, current<s, f'${s:,.2f}')
    for p in [9,21,50,100,200]:
        e=ema(closes[-p:],p)
        sig(f'EMA({p})', e, current>e, current<e, f'${e:,.2f}')

    buys   = sum(1 for s,*_ in signals if s=='BUY')
    sells  = sum(1 for s,*_ in signals if s=='SELL')
    neuts  = sum(1 for s,*_ in signals if s=='NEUTRAL')
    total  = len(signals)
    score  = (buys-sells)/total*100 if total else 0

    if   score > 40:  summary='Forte Alta';  color='green'
    elif score > 15:  summary='Alta';          color='green'
    elif score < -40: summary='Forte Baixa';  color='red'
    elif score < -15: summary='Baixa';         color='red'
    else:             summary='Neutro';        color='neutral'

    return {
        'summary':  summary, 'color': color, 'score': round(score,1),
        'buys':  buys, 'sells': sells, 'neutrals': neuts,
        'total': total, 'signals': signals[:20]
    }

# ── Main ──────────────────────────────────────────────────────────────────────
def analyze(symbol, timeframe='1h', limit=200):
    klines = client.get_klines(symbol=symbol, interval=timeframe, limit=limit)
    candles_list=[Candle(open=float(k[1]),high=float(k[2]),low=float(k[3]),
                         close=float(k[4]),volume=float(k[5])) for k in klines]
    closes  = [c.close  for c in candles_list]
    highs   = [c.high   for c in candles_list]
    lows    = [c.low    for c in candles_list]
    volumes = [c.volume for c in candles_list]
    current = closes[-1]

    # Candlestick patterns
    pats, pred = run_all(candles_list[-30:], 'neutral')

    return {
        'symbol':     symbol,
        'timeframe':  timeframe,
        'price':      round(current,6),
        'change_pct': round((current-closes[-2])/closes[-2]*100,2) if len(closes)>=2 else 0,
        'tech_summary': tech_summary(closes,highs,lows,volumes,current),
        'order_blocks': find_order_blocks(candles_list),
        'fvg':          find_fvg(candles_list),
        'harmonics':    find_harmonics(closes,highs,lows),
        'smc':          smc_analysis(candles_list,closes,volumes),
        'patterns':     [{'name':p.name,'signal':p.signal.value,
                          'confidence':p.confidence,'target':p.target_pct} for p in pats[:5]],
        'prediction':   pred,
        'indicators': {
            'rsi':    round(rsi(closes),1),
            'macd_hist': round(macd(closes)[2],4),
            'adx':    adx(highs,lows,closes),
            'atr':    round(atr(highs,lows,closes),2),
            'bb':     bollinger(closes),
            'vwap':   vwap(highs,lows,closes,volumes),
        }
    }

if __name__=='__main__':
    try:
        p=json.loads(sys.argv[1]) if len(sys.argv)>1 else {}
        result=analyze(p.get('symbol','BTCUSDT'), p.get('timeframe','1h'), int(p.get('limit',200)))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error':str(e)}))
