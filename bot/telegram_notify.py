"""
CryptoEdge Pro — Telegram Notifications
"""
import os, requests, logging
from datetime import datetime

log = logging.getLogger('CryptoEdge.Telegram')

TELEGRAM_TOKEN   = os.environ.get('TELEGRAM_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')

def _send(text: str) -> bool:
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    try:
        url = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage'
        r   = requests.post(url, json={
            'chat_id':    TELEGRAM_CHAT_ID,
            'text':       text,
            'parse_mode': 'HTML'
        }, timeout=8)
        return r.status_code == 200
    except Exception as e:
        log.warning(f'Telegram error: {e}')
        return False

def _ts() -> str:
    return datetime.now().strftime('%d/%m %H:%M')

def notify_start(symbol: str, strategy: str, capital: float, testnet: bool):
    icon = '🧪' if testnet else '🚀'
    _send(
        f'{icon} <b>CryptoEdge Bot Iniciado</b>\n'
        f'Par: <code>{symbol}</code>\n'
        f'Estratégia: <code>{strategy.upper()}</code>\n'
        f'Capital: <code>${capital:,.2f}</code>\n'
        f'Modo: <code>{"TESTNET" if testnet else "REAL ⚠"}</code>\n'
        f'<i>{_ts()}</i>'
    )

def notify_entry(side: str, symbol: str, price: float, qty: float,
                 sl: float, tp: float, reason: str = ''):
    icon = '🟢' if side == 'BUY' else '🔴'
    dir_ = 'LONG' if side == 'BUY' else 'SHORT'
    _send(
        f'{icon} <b>Entrada {dir_} — {symbol}</b>\n'
        f'Preço: <code>${price:,.2f}</code>\n'
        f'Qtd:   <code>{qty:.6f}</code>\n'
        f'SL:    <code>${sl:,.2f}</code>\n'
        f'TP:    <code>${tp:,.2f}</code>\n'
        f'Setup: <i>{reason}</i>\n'
        f'<i>{_ts()}</i>'
    )

def notify_exit(side: str, symbol: str, entry: float, exit_price: float,
                pnl: float, reason: str = ''):
    icon = '✅' if pnl >= 0 else '🛑'
    pnl_icon = '📈' if pnl >= 0 else '📉'
    _send(
        f'{icon} <b>Saída {side} — {symbol}</b>\n'
        f'Entrada: <code>${entry:,.2f}</code> → Saída: <code>${exit_price:,.2f}</code>\n'
        f'{pnl_icon} PnL: <code>${pnl:+.2f}</code>\n'
        f'Motivo: <i>{reason}</i>\n'
        f'<i>{_ts()}</i>'
    )

def notify_stop_loss_global(symbol: str, price: float):
    _send(
        f'⛔ <b>STOP LOSS GLOBAL — {symbol}</b>\n'
        f'Preço atingiu: <code>${price:,.2f}</code>\n'
        f'Todas as ordens canceladas.\n'
        f'<i>{_ts()}</i>'
    )

def notify_error(msg: str):
    _send(f'❌ <b>Erro no Bot</b>\n<code>{msg[:300]}</code>\n<i>{_ts()}</i>')
