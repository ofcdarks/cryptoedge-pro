#!/usr/bin/env python3
"""
CryptoEdge Pro — Pattern Scanner
Scans multiple symbols and returns detected patterns for each.
"""
import sys, json, os
from binance.client import Client
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))
from patterns import Candle, run_all

def scan(symbols, timeframe='15m', limit=50):
    client = Client(
        os.environ.get('BINANCE_API_KEY', ''),
        os.environ.get('BINANCE_SECRET_KEY', ''),
        testnet=False
    )
    results = []
    for sym in symbols:
        try:
            klines = client.get_klines(symbol=sym, interval=timeframe, limit=limit)
            candles = [
                Candle(open=float(k[1]), high=float(k[2]), low=float(k[3]),
                       close=float(k[4]), volume=float(k[5]))
                for k in klines
            ]
            if len(candles) < 5:
                continue
            # Determine trend
            closes = [c.close for c in candles]
            trend = 'up' if closes[-1] > closes[-10] else 'down' if closes[-1] < closes[-10] else 'neutral'
            patterns, prediction = run_all(candles, trend)
            current_price = candles[-1].close
            change_pct    = (candles[-1].close - candles[-2].close) / candles[-2].close * 100 if len(candles) >= 2 else 0
            results.append({
                'symbol':       sym,
                'price':        round(current_price, 6),
                'change_pct':   round(change_pct, 2),
                'trend':        trend,
                'patterns':     [
                    {'name': p.name, 'signal': p.signal.value,
                     'confidence': round(p.confidence, 2), 'target_pct': p.target_pct}
                    for p in patterns[:5]
                ],
                'prediction':   {
                    'direction':  prediction.get('direction', 'neutral'),
                    'confidence': round(prediction.get('confidence', 0), 2),
                    'target_pct': round(prediction.get('target_pct', 0), 1),
                },
                'pattern_count': len(patterns),
                'top_pattern':   patterns[0].name if patterns else None,
            })
        except Exception as e:
            results.append({'symbol': sym, 'error': str(e)})

    # Sort by pattern count + confidence
    results.sort(key=lambda x: (x.get('pattern_count', 0), x.get('prediction', {}).get('confidence', 0)), reverse=True)
    return results

if __name__ == '__main__':
    try:
        params   = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        symbols  = params.get('symbols', ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT'])
        timeframe= params.get('timeframe', '15m')
        result   = scan(symbols, timeframe)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps([{'error': str(e)}]))
