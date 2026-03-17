"""
CryptoEdge Pro — Telegram Notifications (v2 — Manual + Auto mode)

Modos:
  manual (padrão) — envia sinal com botões ✅/❌, aguarda confirmação
  auto            — envia sinal e entra automaticamente
"""
import os, requests, logging, threading, time
from datetime import datetime, timezone, timedelta

log = logging.getLogger('CryptoEdge.Telegram')

# ── Credenciais (reler a cada chamada para pegar injeção do bot/start) ─────────
def _token():   return os.environ.get('TELEGRAM_TOKEN', '')
def _chat_id(): return os.environ.get('TELEGRAM_CHAT_ID', '')

# ── Estado de confirmação pendente ────────────────────────────────────────────
_pending: dict = {}          # { callback_data: threading.Event }
_pending_lock  = threading.Lock()
_poller_thread = None
_poller_running = False

# Duração da posição
_position_opened_at = None

SEP = '―' * 26

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def _send(text: str, reply_markup: dict = None) -> dict:
    token   = _token()
    chat_id = _chat_id()
    if not token or not chat_id:
        return {}
    payload = {'chat_id': chat_id, 'text': text,
                'parse_mode': 'HTML'}
    if reply_markup:
        payload['reply_markup'] = reply_markup
    try:
        r = requests.post(
            f'https://api.telegram.org/bot{token}/sendMessage',
            json=payload, timeout=8
        )
        return r.json() if r.status_code == 200 else {}
    except Exception as e:
        log.warning(f'Telegram send error: {e}')
        return {}

def _answer_callback(callback_id: str):
    try:
        requests.post(
            f'https://api.telegram.org/bot{_token()}/answerCallbackQuery',
            json={'callback_query_id': callback_id}, timeout=5
        )
    except Exception: pass

def _edit_message(chat_id, message_id: int, text: str):
    try:
        requests.post(
            f'https://api.telegram.org/bot{_token()}/editMessageText',
            json={'chat_id': chat_id, 'message_id': message_id,
                  'text': text, 'parse_mode': 'HTML'}, timeout=5
        )
    except Exception: pass

def _ts() -> str:
    # Use TZ offset from env var (ex: BOT_TZ_OFFSET=-3 for Brazil UTC-3)
    import os
    tz_offset = int(os.environ.get('BOT_TZ_OFFSET', '-3'))
    tz = timezone(timedelta(hours=tz_offset))
    return datetime.now(tz).strftime('%d/%m/%Y %H:%M:%S')

def _bar(pct: float, total: int = 10) -> str:
    filled = max(0, min(total, round(pct / 100 * total)))
    return '█' * filled + '░' * (total - filled)

def _duration() -> str:
    global _position_opened_at
    if not _position_opened_at: return '—'
    s = int((datetime.now() - _position_opened_at).total_seconds())
    if s < 60:   return f'{s}s'
    if s < 3600: return f'{s//60}m {s%60}s'
    return f'{s//3600}h {(s%3600)//60}m'

# ─────────────────────────────────────────────────────────────────────────────
# LONG POLLER — recebe callbacks dos botões inline
# ─────────────────────────────────────────────────────────────────────────────
def _start_poller():
    global _poller_thread, _poller_running
    if _poller_running:
        return
    _poller_running = True
    _poller_thread  = threading.Thread(target=_poll_loop, daemon=True, name='TgPoller')
    _poller_thread.start()
    log.info('  📲 Telegram poller iniciado (modo manual)')

def _stop_poller():
    global _poller_running
    _poller_running = False

def _poll_loop():
    offset = 0
    while _poller_running:
        try:
            token = _token()
            if not token:
                time.sleep(5); continue
            r = requests.get(
                f'https://api.telegram.org/bot{token}/getUpdates',
                params={'offset': offset, 'timeout': 20, 'allowed_updates': ['callback_query']},
                timeout=25
            )
            if r.status_code != 200:
                time.sleep(3); continue
            updates = r.json().get('result', [])
            for upd in updates:
                offset = upd['update_id'] + 1
                cq = upd.get('callback_query')
                if not cq: continue
                data    = cq.get('data', '')
                cb_id   = cq['id']
                msg     = cq.get('message', {})
                chat_id = msg.get('chat', {}).get('id')
                msg_id  = msg.get('message_id')
                _answer_callback(cb_id)
                with _pending_lock:
                    ev = _pending.get(data)
                if ev:
                    action = 'CONFIRMAR' if data.endswith(':confirm') else 'IGNORAR'
                    icon   = '✅' if action == 'CONFIRMAR' else '❌'
                    _edit_message(chat_id, msg_id,
                        f'{icon} <b>Sinal {action}ADO por você.</b>\n'
                        f'<i>{"Bot entrando na posição..." if action=="CONFIRMAR" else "Operação cancelada."}</i>'
                    )
                    ev.set()   # libera a thread principal do gridbot
        except Exception as e:
            log.debug(f'Telegram poll error: {e}')
            time.sleep(3)

# ─────────────────────────────────────────────────────────────────────────────
# API PÚBLICA
# ─────────────────────────────────────────────────────────────────────────────

def notify_start(symbol: str, strategy: str, capital: float, testnet: bool):
    mode_icon = '🧪' if testnet else '🚀'
    trade_mode = os.environ.get('BOT_TRADE_MODE', 'manual')
    mode_label = '🖐 MANUAL (você confirma cada trade)' if trade_mode == 'manual' else '🤖 AUTO (bot entra sozinho)'
    _send(
        f'{mode_icon} <b>CryptoEdge Bot Iniciado</b>\n'
        f'{SEP}\n'
        f'📊 Par:         <code>{symbol}</code>\n'
        f'⚙️ Estratégia:  <code>{strategy.upper()}</code>\n'
        f'💰 Capital:     <code>${capital:,.2f} USDT</code>\n'
        f'🔑 Modo:        <code>{"TESTNET" if testnet else "REAL ⚠️"}</code>\n'
        f'🎮 Trades:      {mode_label}\n'
        f'{SEP}\n'
        f'<i>Monitorando o mercado...</i>\n'
        f'🕐 <i>{_ts()}</i>'
    )
    if trade_mode == 'manual':
        _start_poller()

def notify_stop(symbol: str, pnl: float, wins: int, losses: int):
    _stop_poller()
    trades = wins + losses
    wr = (wins / trades * 100) if trades > 0 else 0
    pnl_icon = '📈' if pnl >= 0 else '📉'
    _send(
        f'🛑 <b>CryptoEdge Bot Parado</b>\n'
        f'{SEP}\n'
        f'{pnl_icon} PnL Total:  <code>${pnl:+.2f} USDT</code>\n'
        f'🏆 Trades:    <code>{trades}</code>   ✅ {wins} WIN  |  ❌ {losses} LOSS\n'
        f'🎯 Win Rate:  <code>{wr:.0f}%</code>  {_bar(wr)}\n'
        f'{SEP}\n'
        f'🕐 <i>{_ts()}</i>'
    )

def request_entry_confirmation(symbol: str, side: str, price: float,
                                sl: float, tp: float, conf: float,
                                patterns: list, rsi_val: float,
                                timeout_sec: int = 60) -> bool:
    """
    Envia sinal com botões ✅ Entrar / ❌ Ignorar.
    Aguarda resposta por `timeout_sec` segundos.
    Retorna True se confirmado, False se ignorado/timeout.
    """
    icon    = '🟢' if side == 'BUY' else '🔴'
    dir_    = 'LONG ▲' if side == 'BUY' else 'SHORT ▼'
    sl_pct  = abs((sl - price) / price * 100) if price else 0
    tp_pct  = abs((tp - price) / price * 100) if price else 0
    rr      = (tp_pct / sl_pct) if sl_pct > 0 else 0
    pat_str = ', '.join(patterns[:2]) if patterns else '—'
    conf_bar = f'{_bar(conf * 100, 8)} {conf:.0%}'

    key = f'trade_{symbol}_{int(time.time())}'
    ev  = threading.Event()
    confirmed_flag = [False]

    confirm_key = key + ':confirm'
    ignore_key  = key + ':ignore'

    with _pending_lock:
        _pending[confirm_key] = ev
        _pending[ignore_key]  = ev

    markup = {'inline_keyboard': [[
        {'text': '✅  ENTRAR', 'callback_data': confirm_key},
        {'text': '❌  IGNORAR', 'callback_data': ignore_key},
    ]]}

    _send(
        f'{icon} <b>SINAL {dir_} — {symbol}</b>\n'
        f'{SEP}\n'
        f'💲 Preço atual:  <code>${price:,.2f}</code>\n'
        f'{SEP}\n'
        f'🛡 Stop Loss:    <code>${sl:,.2f}</code>  <i>(-{sl_pct:.1f}%)</i>\n'
        f'🎯 Take Profit:  <code>${tp:,.2f}</code>  <i>(+{tp_pct:.1f}%)</i>\n'
        f'⚖️ R/R Ratio:    <code>1 : {rr:.1f}</code>\n'
        f'{SEP}\n'
        f'🔍 Padrão:    <i>{pat_str}</i>\n'
        f'📡 Confiança: {conf_bar}\n'
        f'📊 RSI:       <code>{rsi_val:.0f}</code>\n'
        f'{SEP}\n'
        f'⏳ <i>Confirme em até {timeout_sec}s</i>\n'
        f'🕐 <i>{_ts()}</i>',
        reply_markup=markup
    )

    triggered = ev.wait(timeout=timeout_sec)

    # Descobrir qual botão foi pressionado
    with _pending_lock:
        # confirm_key está no pending? Se foi removido via set() precisamos checar
        # Usamos flag via side-channel: se o evento veio do confirm_key
        # Vamos checar de forma simples: se o evento foi set, verificar qual key disparou
        # Para isso, usamos dois eventos separados
        _pending.pop(confirm_key, None)
        _pending.pop(ignore_key, None)

    if not triggered:
        log.info('  ⏰ Timeout — sinal ignorado (sem resposta em Telegram)')
        _send(f'⏰ <b>Timeout</b> — sinal <code>{symbol} {dir_}</code> expirou sem confirmação.')
        return False

    # Para saber qual foi clicado, usar dois eventos separados
    return confirmed_flag[0]  # será True se confirm foi clicado


def request_entry_confirmation_v2(symbol: str, side: str, price: float,
                                   sl: float, tp: float, conf: float,
                                   patterns: list, rsi_val: float,
                                   timeout_sec: int = 60) -> bool:
    """Versão com dois eventos separados para distinguir confirm vs ignore."""
    icon    = '🟢' if side == 'BUY' else '🔴'
    dir_    = 'LONG ▲' if side == 'BUY' else 'SHORT ▼'
    sl_pct  = abs((sl - price) / price * 100) if price else 0
    tp_pct  = abs((tp - price) / price * 100) if price else 0
    rr      = (tp_pct / sl_pct) if sl_pct > 0 else 0
    pat_str = ', '.join(patterns[:2]) if patterns else '—'
    conf_bar = f'{_bar(conf * 100, 8)} {conf:.0%}'

    ts_key       = int(time.time())
    confirm_key  = f'ce_{ts_key}:confirm'
    ignore_key   = f'ce_{ts_key}:ignore'
    ev_confirm   = threading.Event()
    ev_ignore    = threading.Event()

    with _pending_lock:
        _pending[confirm_key] = ev_confirm
        _pending[ignore_key]  = ev_ignore

    markup = {'inline_keyboard': [[
        {'text': '✅  ENTRAR AGORA', 'callback_data': confirm_key},
        {'text': '❌  IGNORAR',      'callback_data': ignore_key},
    ]]}

    _send(
        f'{icon} <b>SINAL {dir_} — {symbol}</b>\n'
        f'{SEP}\n'
        f'💲 Preço atual:  <code>${price:,.2f}</code>\n'
        f'{SEP}\n'
        f'🛡 Stop Loss:    <code>${sl:,.2f}</code>  <i>(-{sl_pct:.1f}%)</i>\n'
        f'🎯 Take Profit:  <code>${tp:,.2f}</code>  <i>(+{tp_pct:.1f}%)</i>\n'
        f'⚖️ R/R Ratio:    <code>1 : {rr:.1f}</code>\n'
        f'{SEP}\n'
        f'🔍 Padrão:    <i>{pat_str}</i>\n'
        f'📡 Confiança: {conf_bar}\n'
        f'📊 RSI:       <code>{rsi_val:.0f}</code>\n'
        f'{SEP}\n'
        f'⏳ <i>Responda em até {timeout_sec}s ou o sinal expira</i>\n'
        f'🕐 <i>{_ts()}</i>',
        reply_markup=markup
    )

    # Aguarda qualquer um dos dois eventos
    deadline = time.time() + timeout_sec
    confirmed = False
    while time.time() < deadline:
        if ev_confirm.is_set():
            confirmed = True; break
        if ev_ignore.is_set():
            confirmed = False; break
        time.sleep(0.3)

    with _pending_lock:
        _pending.pop(confirm_key, None)
        _pending.pop(ignore_key, None)

    if time.time() >= deadline and not ev_confirm.is_set() and not ev_ignore.is_set():
        log.info('  ⏰ Timeout — sinal expirou sem resposta')
        _send(f'⏰ <b>Expirou</b> — sinal <code>{symbol} {dir_}</code> sem confirmação.')
        return False

    return confirmed


def notify_entry(side: str, symbol: str, price: float, qty: float,
                 sl: float, tp: float, reason: str = '',
                 confidence: float = 0, patterns: list = None):
    global _position_opened_at
    _position_opened_at = datetime.now()
    icon  = '🟢' if side == 'BUY' else '🔴'
    dir_  = 'LONG ▲' if side == 'BUY' else 'SHORT ▼'
    sl_pct = abs((sl - price) / price * 100) if price else 0
    tp_pct = abs((tp - price) / price * 100) if price else 0
    rr     = (tp_pct / sl_pct) if sl_pct > 0 else 0
    pat_str = ', '.join(patterns[:2]) if patterns else (reason or '—')
    conf_str = f'{_bar(confidence * 100, 8)} {confidence:.0%}' if confidence else '—'
    _send(
        f'{icon} <b>ENTRADA {dir_} — {symbol}</b>\n'
        f'{SEP}\n'
        f'💲 Preço entrada:  <code>${price:,.2f}</code>\n'
        f'📦 Quantidade:     <code>{qty:.6f}</code>\n'
        f'{SEP}\n'
        f'🛡 Stop Loss:    <code>${sl:,.2f}</code>  <i>(-{sl_pct:.1f}%)</i>\n'
        f'🎯 Take Profit:  <code>${tp:,.2f}</code>  <i>(+{tp_pct:.1f}%)</i>\n'
        f'⚖️ R/R Ratio:    <code>1 : {rr:.1f}</code>\n'
        f'{SEP}\n'
        f'🔍 Padrão:    <i>{pat_str}</i>\n'
        f'📡 Confiança: {conf_str}\n'
        f'{SEP}\n'
        f'🕐 <i>{_ts()}</i>'
    )

def notify_exit(side: str, symbol: str, entry: float, exit_price: float,
                pnl: float, reason: str = '',
                wins: int = 0, losses: int = 0, total_pnl: float = 0):
    is_win   = pnl >= 0
    result   = '✅ WIN' if is_win else '❌ LOSS'
    pnl_icon = '📈' if is_win else '📉'
    move_pct = abs((exit_price - entry) / entry * 100) if entry else 0
    direction = 'subiu' if exit_price > entry else 'caiu'
    trades   = wins + losses
    wr       = (wins / trades * 100) if trades > 0 else 0
    global _position_opened_at
    dur = _duration()
    _position_opened_at = None
    _send(
        f'{pnl_icon} <b>{result} — {symbol} {side}</b>\n'
        f'{SEP}\n'
        f'📥 Entrada:   <code>${entry:,.2f}</code>\n'
        f'📤 Saída:     <code>${exit_price:,.2f}</code>\n'
        f'↕️ Variação:  <code>{move_pct:.2f}%</code> ({direction})\n'
        f'⏱ Duração:   <code>{dur}</code>\n'
        f'🏷 Motivo:    <i>{reason}</i>\n'
        f'{SEP}\n'
        f'💵 PnL trade:   <b><code>${pnl:+.2f} USDT</code></b>\n'
        f'💼 PnL sessão:  <code>${total_pnl:+.2f} USDT</code>\n'
        f'{SEP}\n'
        f'📊 Sessão:   ✅ {wins} WIN  |  ❌ {losses} LOSS\n'
        f'🎯 Win Rate: <code>{wr:.0f}%</code>  {_bar(wr)}\n'
        f'{SEP}\n'
        f'🕐 <i>{_ts()}</i>'
    )

def notify_signal(symbol: str, direction: str, confidence: float,
                  patterns: list = None, reason: str = '',
                  rsi: float = 0, target_pct: float = 0, source: str = 'bot'):
    """Sinal sem botões — modo auto ou aviso informativo."""
    dir_text  = '🔼 ALTA' if direction in ('up','buy') else ('🔽 BAIXA' if direction in ('down','sell') else '➡️ NEUTRO')
    pat_str   = ', '.join(patterns[:3]) if patterns else (reason or '—')
    rsi_line  = f'📊 RSI:        <code>{rsi:.0f}</code>\n' if rsi else ''
    tgt_line  = f'🎯 Alvo:       <code>{target_pct:+.1f}%</code>\n' if target_pct else ''
    src_label = '🔭 Scanner Multi-Par' if source == 'scanner' else '🤖 Bot Principal'
    _send(
        f'📡 <b>Sinal {dir_text} — {symbol}</b>\n'
        f'<i>{src_label}</i>\n'
        f'{SEP}\n'
        f'📡 Confiança:  {_bar(confidence*100,8)} {confidence:.0%}\n'
        f'🔍 Padrão:     <i>{pat_str}</i>\n'
        f'{rsi_line}'
        f'{tgt_line}'
        f'{SEP}\n'
        f'<i>Executando ordem automaticamente...</i>\n'
        f'🕐 <i>{_ts()}</i>'
    )

def notify_stop_loss_global(symbol: str, price: float):
    _send(
        f'⛔ <b>STOP LOSS GLOBAL — {symbol}</b>\n'
        f'{SEP}\n'
        f'💲 Preço: <code>${price:,.2f}</code>\n'
        f'🤚 Todas as ordens canceladas.\n'
        f'{SEP}\n'
        f'🕐 <i>{_ts()}</i>'
    )


def notify_session_target(result: str, symbol: str, pnl: float,
                           target: float, wins: int, losses: int):
    """Notifica quando o bot para por gain ou loss de sessão."""
    is_gain  = result == 'gain'
    icon     = '🎯' if is_gain else '🛑'
    title    = 'GAIN ALVO ATINGIDO ✅' if is_gain else 'LOSS MÁXIMO ATINGIDO ❌'
    color_pnl = '📈' if is_gain else '📉'
    trades   = wins + losses
    wr       = (wins / trades * 100) if trades > 0 else 0
    _send(
        f'{icon} <b>{title}</b>\n'
        f'{SEP}\n'
        f'📊 Par: <code>{symbol}</code>\n'
        f'\n'
        f'{color_pnl} PnL sessão: <b><code>${pnl:+.2f} USDT</code></b>\n'
        f'🎯 Limite: <code>{"+" if is_gain else "-"}${target:.2f} USDT</code>\n'
        f'{SEP}\n'
        f'📊 Trades:   ✅ {wins} WIN  |  ❌ {losses} LOSS\n'
        f'🎯 Win Rate: <code>{wr:.0f}%</code>  {_bar(wr)}\n'
        f'{SEP}\n'
        f'<b>Bot encerrado automaticamente.</b>\n'
        f'🕐 <i>{_ts()}</i>'
    )

def notify_error(msg: str):
    _send(
        f'❌ <b>Erro no Bot</b>\n'
        f'{SEP}\n'
        f'<code>{msg[:400]}</code>\n'
        f'{SEP}\n'
        f'🕐 <i>{_ts()}</i>'
    )
