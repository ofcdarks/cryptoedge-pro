"""
CryptoEdge Pro — HFT Analytics Engine v1.0
===========================================
Fases 1, 2 e 3 do sistema adaptativo:

Fase 1 — Estatística adaptativa
  - Win rate por moeda, horário, dia da semana
  - PnL líquido por contexto
  - Profit factor, drawdown, custo médio de taxa
  - Auto-bloqueio de contextos ruins

Fase 3 — Score por par/horário/estratégia
  score_final = 0.35*wr + 0.30*pnl_liq + 0.15*pf + 0.10*estab + 0.10*low_dd

  score > 0.75  → LIBERADO
  0.60–0.75     → CAUTELA (stake 50%)
  < 0.60        → BLOQUEADO

Fase 4 — Guardião de parâmetros
  - Nunca aumenta mão acima do permitido
  - Nunca remove stop diário
  - Mantém parâmetros dentro de faixas seguras
"""

import os, json, logging, threading, time
from collections import defaultdict, deque
from datetime import datetime, timedelta
import datetime as dt

log = logging.getLogger('CryptoEdge.Analytics')

def _data_dir():
    d = os.environ.get('BOT_DATA_DIR', '')
    if d: return d
    if os.path.isdir('/data'): return '/data'
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(local, exist_ok=True)
    return local

_ANALYTICS_FILE = os.environ.get('HFT_ANALYTICS_FILE', os.path.join(_data_dir(), 'hft_analytics.json'))

# ── Guardião de limites ───────────────────────────────────────────────────────
GUARDIAN = {
    'min_confidence':   0.55,
    'max_confidence':   0.90,
    'min_rr':           1.4,
    'max_rr':           4.0,
    'min_stake_mult':   0.30,
    'max_stake_mult':   1.20,
    'min_tp_pct':       0.50,
    'max_tp_pct':       4.00,
    'min_sl_pct':       0.20,
    'max_sl_pct':       2.00,
    'max_blocked_pairs':6,     # nunca bloqueia mais de 6 pares simultâneos
}

# Janela de análise: últimas N trades por contexto
WINDOW_TRADES = int(os.environ.get('HFT_ANALYTICS_WINDOW', '50'))
MIN_TRADES_SCORE = int(os.environ.get('HFT_MIN_TRADES_SCORE', '8'))  # mínimo p/ gerar score


class TradeRecord:
    """Registro completo de uma trade para aprendizado."""
    __slots__ = [
        'ts', 'pair', 'side', 'entry', 'exit', 'qty',
        'pnl_gross', 'pnl_net', 'fee', 'duration_sec',
        'rsi', 'adx', 'regime', 'volume_ratio', 'spread_pct',
        'score', 'confidence', 'strategies', 'entry_reason', 'exit_reason',
        'hour', 'weekday', 'win', 'tp_pct', 'sl_pct',
    ]
    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))

    def to_dict(self):
        return {k: getattr(self, k) for k in self.__slots__}

    @classmethod
    def from_dict(cls, d):
        return cls(**{k: d.get(k) for k in cls.__slots__})


class ContextStats:
    """Estatísticas acumuladas para um contexto (par, horário, estratégia)."""
    def __init__(self):
        self.records = deque(maxlen=WINDOW_TRADES)

    def add(self, record: TradeRecord):
        self.records.append(record)

    def compute(self) -> dict:
        recs = list(self.records)
        n = len(recs)
        if n == 0:
            return {'n': 0, 'score': None, 'status': 'sem dados'}

        wins   = [r for r in recs if r.win]
        losses = [r for r in recs if not r.win]
        wr     = len(wins) / n

        pnl_nets    = [r.pnl_net for r in recs if r.pnl_net is not None]
        total_pnl   = sum(pnl_nets)
        avg_pnl     = total_pnl / n if n > 0 else 0

        gross_win  = sum(r.pnl_net for r in wins if r.pnl_net)
        gross_loss = abs(sum(r.pnl_net for r in losses if r.pnl_net))
        pf         = gross_win / gross_loss if gross_loss > 0 else (99.0 if gross_win > 0 else 0.0)

        fees   = [r.fee for r in recs if r.fee is not None]
        avg_fee = sum(fees) / len(fees) if fees else 0

        # Drawdown: pior sequência de perdas consecutivas
        max_dd = 0; cur_dd = 0
        for r in recs:
            if not r.win:
                cur_dd += abs(r.pnl_net or 0)
                max_dd = max(max_dd, cur_dd)
            else:
                cur_dd = 0

        # Estabilidade: std do pnl normalizado
        if len(pnl_nets) > 1:
            mu  = avg_pnl
            var = sum((p - mu)**2 for p in pnl_nets) / len(pnl_nets)
            std = var**0.5
            stab = 1.0 / (1.0 + std) if std >= 0 else 0.5
        else:
            stab = 0.5

        # Score composto (só calcula com dados suficientes)
        score = None
        if n >= MIN_TRADES_SCORE:
            wr_norm   = wr
            pnl_norm  = min(max(avg_pnl / 0.50 + 0.5, 0), 1.0)  # normaliza em torno de 0
            pf_norm   = min(pf / 3.0, 1.0)
            dd_norm   = 1.0 - min(max_dd / 2.0, 1.0)
            score = (
                0.35 * wr_norm +
                0.30 * pnl_norm +
                0.15 * pf_norm +
                0.10 * stab +
                0.10 * dd_norm
            )
            score = round(min(max(score, 0), 1), 3)

        status = 'sem dados' if score is None else (
            'LIBERADO'  if score >= 0.75 else
            'CAUTELA'   if score >= 0.60 else
            'BLOQUEADO'
        )
        stake_mult = 1.0 if score is None or score >= 0.75 else (
            0.50 if score >= 0.60 else 0.0
        )

        return {
            'n': n, 'wr': round(wr * 100, 1), 'pnl_total': round(total_pnl, 4),
            'avg_pnl': round(avg_pnl, 4), 'profit_factor': round(pf, 2),
            'avg_fee': round(avg_fee, 4), 'max_drawdown': round(max_dd, 4),
            'stability': round(stab, 3), 'score': score, 'status': status,
            'stake_mult': stake_mult,
        }


class HFTAnalytics:
    """Motor central de analytics adaptativo."""

    def __init__(self):
        self._lock      = threading.Lock()
        self._by_pair   = defaultdict(ContextStats)   # pair → stats
        self._by_hour   = defaultdict(ContextStats)   # "HH" → stats
        self._by_wday   = defaultdict(ContextStats)   # "Mon" → stats
        self._by_strat  = defaultdict(ContextStats)   # strategy → stats
        self._by_regime = defaultdict(ContextStats)   # regime → stats
        self._all       = ContextStats()              # global
        self._blocked_pairs    = set()
        self._cautious_pairs   = set()
        self._blocked_hours    = set()
        self._dynamic_params   = {}  # ajustes dinâmicos dentro das faixas
        self._last_save        = 0
        self._load()
        log.info('  📊 Analytics Engine v1.0 iniciado')

    # ── Registro de trade ──────────────────────────────────────────────────

    def record(self, pair: str, side: str, entry: float, exit_price: float,
               qty: float, pnl_gross: float, fee: float, duration_sec: float,
               rsi: float, adx: float, regime: str, volume_ratio: float,
               score: float, confidence: float, strategies: list,
               entry_reason: str, exit_reason: str, tp_pct: float, sl_pct: float):
        """Registra trade completa com contexto completo."""
        pnl_net = pnl_gross - fee
        win     = pnl_net > 0
        now     = datetime.now()
        hour    = now.hour
        wday    = now.strftime('%a')

        rec = TradeRecord(
            ts=now.isoformat(), pair=pair, side=side,
            entry=entry, exit=exit_price, qty=qty,
            pnl_gross=round(pnl_gross, 6), pnl_net=round(pnl_net, 6),
            fee=round(fee, 6), duration_sec=round(duration_sec, 1),
            rsi=round(rsi or 0, 1), adx=round(adx or 0, 1),
            regime=regime or 'unknown', volume_ratio=round(volume_ratio or 1, 2),
            score=round(score or 0, 3), confidence=round(confidence or 0, 3),
            strategies=list(strategies or []),
            entry_reason=entry_reason or '', exit_reason=exit_reason or '',
            hour=hour, weekday=wday, win=win,
            tp_pct=round(tp_pct or 0, 3), sl_pct=round(sl_pct or 0, 3),
        )

        with self._lock:
            self._by_pair[pair].add(rec)
            self._by_hour[f'{hour:02d}h'].add(rec)
            self._by_wday[wday].add(rec)
            for s in (strategies or []):
                self._by_strat[s].add(rec)
            if regime:
                self._by_regime[regime].add(rec)
            self._all.add(rec)
            self._update_blocks()

        # Salva a cada 10 trades
        self._dirty = getattr(self, '_dirty', 0) + 1
        if self._dirty >= 10:
            self._save()
            self._dirty = 0

    # ── Bloqueios adaptativos ──────────────────────────────────────────────

    def _update_blocks(self):
        """Atualiza pares/horários bloqueados com base nos scores."""
        new_blocked = set()
        new_cautious = set()

        for pair, ctx in self._by_pair.items():
            s = ctx.compute()
            if s['score'] is not None:
                if s['status'] == 'BLOQUEADO':
                    new_blocked.add(pair)
                elif s['status'] == 'CAUTELA':
                    new_cautious.add(pair)

        # Guardião: nunca bloqueia mais de N pares
        if len(new_blocked) > GUARDIAN['max_blocked_pairs']:
            # Mantém só os N piores
            sorted_blocked = sorted(
                new_blocked,
                key=lambda p: self._by_pair[p].compute().get('score', 0.5)
            )
            new_blocked = set(sorted_blocked[:GUARDIAN['max_blocked_pairs']])

        blocked_hours = set()
        for hour, ctx in self._by_hour.items():
            s = ctx.compute()
            if s['score'] is not None and s['status'] == 'BLOQUEADO':
                blocked_hours.add(hour)

        if self._blocked_pairs != new_blocked or self._cautious_pairs != new_cautious:
            added   = new_blocked - self._blocked_pairs
            removed = self._blocked_pairs - new_blocked
            if added:   log.info(f'  🚫 Analytics BLOQUEOU pares: {added}')
            if removed: log.info(f'  ✅ Analytics LIBEROU pares: {removed}')

        self._blocked_pairs  = new_blocked
        self._cautious_pairs = new_cautious
        self._blocked_hours  = blocked_hours

    # ── Consultas ──────────────────────────────────────────────────────────

    def get_pair_status(self, pair: str) -> dict:
        """Retorna status e stake_mult para um par."""
        with self._lock:
            s = self._by_pair[pair].compute()
        blocked = pair in self._blocked_pairs
        cautious = pair in self._cautious_pairs
        return {
            'pair':        pair,
            'status':      'BLOQUEADO' if blocked else ('CAUTELA' if cautious else s.get('status', 'LIBERADO')),
            'stake_mult':  0.0 if blocked else (0.5 if cautious else s.get('stake_mult', 1.0)),
            'score':       s.get('score'),
            'n':           s.get('n', 0),
            'wr':          s.get('wr', 0),
            'avg_pnl':     s.get('avg_pnl', 0),
            'pf':          s.get('profit_factor', 0),
        }

    def get_hour_status(self, hour: int) -> dict:
        """Retorna se o horário atual é bom para operar."""
        label = f'{hour:02d}h'
        with self._lock:
            s = self._by_hour[label].compute()
        return {
            'hour':   label,
            'status': s.get('status', 'sem dados'),
            'score':  s.get('score'),
            'n':      s.get('n', 0),
            'wr':     s.get('wr', 0),
            'avg_pnl': s.get('avg_pnl', 0),
        }

    def should_enter(self, pair: str, side: str, hour: int) -> tuple:
        """
        Retorna (pode_entrar: bool, stake_mult: float, motivo: str)
        Consulta par + horário e retorna decisão combinada.
        """
        pair_s = self.get_pair_status(pair)
        hour_s = self.get_hour_status(hour)

        if pair_s['status'] == 'BLOQUEADO':
            return False, 0.0, f'Par {pair} bloqueado (score {pair_s["score"]:.2f}, {pair_s["n"]} trades)'

        if hour_s['status'] == 'BLOQUEADO':
            return False, 0.0, f'Horário {hour}h bloqueado (score {hour_s["score"]:.2f})'

        stake = pair_s['stake_mult']
        if pair_s['status'] == 'CAUTELA' or hour_s['status'] == 'CAUTELA':
            stake = min(stake, 0.5)
            return True, stake, f'Modo CAUTELA — stake {stake:.0%}'

        return True, stake, 'OK'

    def get_full_report(self) -> dict:
        """Relatório completo para API e painel."""
        with self._lock:
            pairs = {p: self._by_pair[p].compute() for p in self._by_pair}
            hours = {h: self._by_hour[h].compute() for h in self._by_hour}
            wdays = {d: self._by_wday[d].compute() for d in self._by_wday}
            strats = {s: self._by_strat[s].compute() for s in self._by_strat}
            overall = self._all.compute()

        # Rankeamentos
        pair_rank  = sorted([(p, d) for p, d in pairs.items() if d['score'] is not None],
                            key=lambda x: x[1]['score'], reverse=True)
        hour_rank  = sorted([(h, d) for h, d in hours.items() if d['score'] is not None],
                            key=lambda x: x[1]['score'], reverse=True)
        strat_rank = sorted([(s, d) for s, d in strats.items() if d['score'] is not None],
                            key=lambda x: x[1]['score'], reverse=True)

        return {
            'overall':      overall,
            'pairs':        pairs,
            'hours':        hours,
            'weekdays':     wdays,
            'strategies':   strats,
            'pair_ranking': [(p, d['score'], d['status'], d['wr'], d['avg_pnl']) for p, d in pair_rank],
            'hour_ranking': [(h, d['score'], d['status'], d['wr'], d['avg_pnl']) for h, d in hour_rank],
            'strat_ranking': [(s, d['score'], d['status'], d['wr'], d['avg_pnl']) for s, d in strat_rank],
            'blocked_pairs':  list(self._blocked_pairs),
            'cautious_pairs': list(self._cautious_pairs),
            'blocked_hours':  list(self._blocked_hours),
        }

    def get_telegram_summary(self) -> str:
        """Resumo compacto para enviar via Telegram."""
        r = self.get_full_report()
        pr = r['pair_ranking']
        hr = r['hour_ranking']

        top_pairs  = pr[:3]
        bot_pairs  = pr[-3:]
        top_hours  = hr[:3]

        lines = ['📊 <b>Analytics — Resumo Adaptativo</b>\n───────────────────────']

        if top_pairs:
            lines.append('<b>✅ Melhores pares:</b>')
            for p, sc, st, wr, ap in top_pairs:
                lines.append(f'  {p.replace("USDT","")} score={sc:.2f} WR={wr:.0f}% avg={ap:+.3f}')

        if bot_pairs and bot_pairs[0][0] not in [x[0] for x in top_pairs]:
            lines.append('<b>❌ Piores pares:</b>')
            for p, sc, st, wr, ap in bot_pairs:
                if sc and sc < 0.65:
                    lines.append(f'  {p.replace("USDT","")} score={sc:.2f} WR={wr:.0f}% [{st}]')

        if top_hours:
            lines.append('<b>🕐 Melhores horários:</b>')
            for h, sc, st, wr, ap in top_hours[:2]:
                lines.append(f'  {h} score={sc:.2f} WR={wr:.0f}%')

        if r['blocked_pairs']:
            bp = ', '.join(p.replace('USDT','') for p in r['blocked_pairs'])
            lines.append(f'🚫 Bloqueados: {bp}')

        return '\n'.join(lines)

    # ── Persistência ───────────────────────────────────────────────────────

    def _save(self):
        try:
            data = {
                'pairs':   {p: [r.to_dict() for r in ctx.records] for p, ctx in self._by_pair.items()},
                'hours':   {h: [r.to_dict() for r in ctx.records] for h, ctx in self._by_hour.items()},
                'wdays':   {d: [r.to_dict() for r in ctx.records] for d, ctx in self._by_wday.items()},
                'strats':  {s: [r.to_dict() for r in ctx.records] for s, ctx in self._by_strat.items()},
                'all':     [r.to_dict() for r in self._all.records],
                'saved_at': datetime.now().isoformat(),
            }
            os.makedirs(os.path.dirname(_ANALYTICS_FILE), exist_ok=True)
            with open(_ANALYTICS_FILE, 'w') as f:
                json.dump(data, f)
            self._last_save = time.time()
        except Exception as e:
            log.debug(f'Analytics save error: {e}')

    def _load(self):
        try:
            if not os.path.exists(_ANALYTICS_FILE): return
            with open(_ANALYTICS_FILE) as f:
                data = json.load(f)
            for p, recs in data.get('pairs', {}).items():
                for r in recs: self._by_pair[p].add(TradeRecord.from_dict(r))
            for h, recs in data.get('hours', {}).items():
                for r in recs: self._by_hour[h].add(TradeRecord.from_dict(r))
            for d, recs in data.get('wdays', {}).items():
                for r in recs: self._by_wday[d].add(TradeRecord.from_dict(r))
            for s, recs in data.get('strats', {}).items():
                for r in recs: self._by_strat[s].add(TradeRecord.from_dict(r))
            for r in data.get('all', []):
                self._all.add(TradeRecord.from_dict(r))
            self._update_blocks()
            n = sum(len(c.records) for c in self._by_pair.values())
            log.info(f'  📊 Analytics: {n} trades carregadas')
        except Exception as e:
            log.debug(f'Analytics load error: {e}')


# ── Singleton ─────────────────────────────────────────────────────────────────
_analytics: HFTAnalytics = None

def get_analytics() -> HFTAnalytics:
    global _analytics
    if _analytics is None:
        _analytics = HFTAnalytics()
    return _analytics
