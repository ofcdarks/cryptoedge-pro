"""
CryptoEdge Pro — Multi-Pair Scanner
Roda em thread separada, escaneia múltiplos pares a cada intervalo
e envia os melhores sinais para o Telegram.
"""
import os, time, threading, logging
from collections import defaultdict
from binance.client import Client
from patterns import Candle, run_all, Signal

log = logging.getLogger('CryptoEdge.Scanner')

# ── Pares padrão monitorados ───────────────────────────────────────────────────
DEFAULT_PAIRS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
    'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT', 'FILUSDT',
]

# Cooldown por par: evita spam de sinais repetidos (segundos)
_COOLDOWN = 900   # 15 min entre sinais do mesmo par
_last_signal: dict = defaultdict(float)
_lock = threading.Lock()

_scanner_thread: threading.Thread = None
_running = False


# ─────────────────────────────────────────────────────────────────────────────
def _get_candles(client: Client, symbol: str, timeframe: str, limit: int = 60):
    klines = client.get_klines(symbol=symbol, interval=timeframe, limit=limit)
    return [
        Candle(open=float(k[1]), high=float(k[2]), low=float(k[3]),
               close=float(k[4]), volume=float(k[5]))
        for k in klines
    ]


def _scan_pair(client: Client, symbol: str, timeframe: str, min_conf: float):
    """Retorna dict com sinal ou None se não há setup."""
    try:
        candles = _get_candles(client, symbol, timeframe)
        if len(candles) < 10:
            return None

        closes = [c.close for c in candles]
        trend  = 'up' if closes[-1] > closes[-10] else ('down' if closes[-1] < closes[-10] else 'neutral')

        patterns, pred = run_all(candles, trend)
        conf  = pred.get('confidence', 0)
        dir_  = pred.get('direction', 'neutral')

        if conf < min_conf or dir_ == 'neutral':
            return None

        # Filtro: precisa de pelo menos 1 padrão com sinal alinhado
        aligned = [
            p for p in patterns
            if p.confidence >= min_conf and (
                (dir_ == 'up'   and p.signal in (Signal.BUY, Signal.STRONG_BUY)) or
                (dir_ == 'down' and p.signal in (Signal.SELL, Signal.STRONG_SELL))
            )
        ]
        if not aligned:
            return None

        price = closes[-1]
        # RSI simples
        gains = losses = 0
        for i in range(1, min(15, len(closes))):
            diff = closes[-i] - closes[-i-1]
            if diff > 0: gains += diff
            else:        losses -= diff
        rsi = 100 - (100 / (1 + gains/losses)) if losses > 0 else 50

        return {
            'symbol':    symbol,
            'direction': dir_,
            'confidence': conf,
            'price':     price,
            'patterns':  [p.name for p in aligned[:3]],
            'target_pct': pred.get('target_pct', 0),
            'rsi':       round(rsi, 1),
            'trend':     trend,
        }
    except Exception as e:
        log.debug(f'Scan {symbol} erro: {e}')
        return None


def _scanner_loop(api_key: str, secret_key: str, pairs: list,
                  timeframe: str, min_conf: float, interval_sec: int,
                  notify_fn, testnet: bool):
    """Thread principal do scanner."""
    global _running
    log.info(f'  🔭 Scanner iniciado — {len(pairs)} pares | {timeframe} | '
             f'conf≥{min_conf:.0%} | intervalo={interval_sec}s')

    client = Client(api_key, secret_key, testnet=testnet)

    while _running:
        signals = []
        for sym in pairs:
            if not _running: break
            result = _scan_pair(client, sym, timeframe, min_conf)
            if result:
                signals.append(result)
            time.sleep(0.3)   # gentil com a API

        if signals:
            # Ordena por confiança
            signals.sort(key=lambda x: x['confidence'], reverse=True)
            now = time.time()

            sent = 0
            for sig in signals:
                sym = sig['symbol']
                with _lock:
                    last = _last_signal.get(sym, 0)
                    if now - last < _COOLDOWN:
                        continue
                    _last_signal[sym] = now

                log.info(f'  📡 Scanner sinal: {sym} {sig["direction"].upper()} '
                         f'conf={sig["confidence"]:.0%} | {sig["patterns"]}')
                notify_fn(sig)
                sent += 1
                if sent >= 3:   # máx 3 sinais por ciclo para não spammar
                    break

        # Aguarda próximo ciclo
        for _ in range(interval_sec):
            if not _running: break
            time.sleep(1)


# ─────────────────────────────────────────────────────────────────────────────
# API pública
# ─────────────────────────────────────────────────────────────────────────────
def start(api_key: str, secret_key: str, notify_fn,
          pairs: list = None, timeframe: str = '15m',
          min_conf: float = 0.68, interval_sec: int = 300,
          testnet: bool = True):
    """
    Inicia o scanner em thread daemon.
    notify_fn(signal_dict) é chamado para cada sinal encontrado.
    """
    global _scanner_thread, _running

    if _running:
        log.warning('  Scanner já está rodando')
        return

    scan_pairs = pairs or DEFAULT_PAIRS
    _running = True
    _scanner_thread = threading.Thread(
        target=_scanner_loop,
        args=(api_key, secret_key, scan_pairs, timeframe,
              min_conf, interval_sec, notify_fn, testnet),
        daemon=True,
        name='MultiScanner'
    )
    _scanner_thread.start()


def stop():
    global _running
    _running = False
    log.info('  🔭 Scanner parado')
