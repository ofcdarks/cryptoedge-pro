"""
CryptoEdge Pro — HFT AI Advisor v2.0
=====================================
IA especialista em crypto HFT — valida cada sinal antes de executar.

NOVIDADES v2.0:
  ✅ Suporte a modelos de raciocínio (DeepSeek-R1, o3) — strip de <think>
  ✅ Dois modelos configuráveis: FAST (decisões rápidas) e DEEP (análise profunda)
  ✅ DeepSeek-V3 como padrão FAST — melhor custo/benefício em JSON
  ✅ DeepSeek-R1 como padrão DEEP — raciocínio quantitativo excepcional
  ✅ Detecção automática de formato de resposta (JSON puro vs <think>+JSON)
  ✅ Timeout adaptativo por modelo (reasoning = mais tempo)
  ✅ Fallback em cadeia: DEEP → FAST → decisão do engine
  ✅ Estatísticas por modelo no dashboard

Hierarquia de decisão:
  Sinal do engine → Confirmação de vela → IA FAST valida rapidamente
  Se IA FAST hesita (REDUCE) → IA DEEP faz análise profunda
  Se IA DEEP confirma → entra | se DEEP rejeita → pula
"""

import os, time, json, threading, logging, urllib.request, urllib.error, re
from collections import deque

log = logging.getLogger('CryptoEdge.AIAdvisor')

# ── Configuração ──────────────────────────────────────────────────────────────
AI_API_KEY   = os.environ.get('LAOZHANG_API_KEY', '') or os.environ.get('AI_API_KEY', '')
AI_BASE_URL  = os.environ.get('LAOZHANG_BASE_URL', 'https://api.laozhang.ai/v1')
AI_ENABLED   = os.environ.get('HFT_AI_ENABLED', 'true').lower() == 'true'
AI_MIN_CONF  = float(os.environ.get('HFT_AI_MIN_CONF', '0.55'))
AI_CACHE_TTL = float(os.environ.get('HFT_AI_CACHE_TTL', '30'))

# Modelo FAST: respostas rápidas, JSON direto, usado em todo sinal
AI_MODEL_FAST    = os.environ.get('HFT_AI_MODEL_FAST',    'deepseek-v3-0324')
AI_TIMEOUT_FAST  = float(os.environ.get('HFT_AI_TIMEOUT_FAST',  '4.0'))

# Modelo DEEP: raciocínio profundo, usado quando FAST hesita (REDUCE)
AI_MODEL_DEEP    = os.environ.get('HFT_AI_MODEL_DEEP',    'deepseek-r1')
AI_TIMEOUT_DEEP  = float(os.environ.get('HFT_AI_TIMEOUT_DEEP',  '10.0'))

# Modelo único legado (compatibilidade com versão anterior)
_AI_MODEL_LEGACY = os.environ.get('AI_MODEL', '')
if _AI_MODEL_LEGACY and _AI_MODEL_LEGACY not in ('qwen3-30b-a3b',):
    AI_MODEL_FAST = _AI_MODEL_LEGACY  # respeita configuração anterior

if not AI_API_KEY:
    AI_ENABLED = False
    log.info('  🤖 AI Advisor: sem chave de API — desativado (configure LAOZHANG_API_KEY)')

# Modelos de raciocínio que emitem <think>...</think> antes do JSON
REASONING_MODELS = {
    'deepseek-r1', 'deepseek-r1-0528', 'deepseek-r1-250528', 'deepseek-reasoner',
    'o1', 'o1-preview', 'o3', 'o3-mini', 'o4-mini',
    'claude-3-7-sonnet-20250219-thinking', 'qwq-32b', 'qwq-plus',
    'deepseek-v3-0324',  # também pensa às vezes
}

def _is_reasoning(model: str) -> bool:
    return any(r in model.lower() for r in ('r1', 'reasoner', 'thinking', 'qwq', 'o1', 'o3', 'o4'))


# ── System Prompt compacto ────────────────────────────────────────────────────
SYSTEM_PROMPT = """Você é um trader profissional especialista em HFT de criptomoedas.
Analise o sinal e decida em formato JSON. Sem texto fora do JSON.

REGRAS:
- Confie em indicadores técnicos + contexto macro
- RSI extremo (<25 ou >75) + volume spike = sinal forte
- Sinal contra EMA50 → penalize confiança
- ADX <18 = mercado fraco → prefira SKIP
- Regime choppy → sempre SKIP
- R:R <1.5 → sempre SKIP
- Histórico ruim no par hoje (WR <40% com +5 trades) → SKIP

RESPOSTA JSON obrigatória:
{
  "decision": "ENTER" | "SKIP" | "REDUCE",
  "confidence": 0.0-1.0,
  "tp_mult": 1.0,
  "sl_mult": 1.0,
  "reason": "máx 12 palavras",
  "risk_level": "LOW" | "MEDIUM" | "HIGH"
}
ENTER=entrar normal | SKIP=ignorar | REDUCE=entrar com 50% do tamanho
tp_mult/sl_mult ajustam TP e SL (1.2 = 20% maior)"""


def _extract_json(text: str) -> dict | None:
    """
    Extrai JSON da resposta — funciona tanto com JSON puro quanto com
    modelos de raciocínio que emitem <think>...</think> antes do JSON.
    """
    if not text: return None
    text = text.strip()

    # Remove bloco <think>...</think> (DeepSeek-R1, QwQ)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()

    # Remove ```json ... ``` ou ``` ... ```
    text = re.sub(r'```(?:json)?\s*', '', text).replace('```', '').strip()

    # Tenta parsear diretamente
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Extrai primeiro bloco JSON { ... }
    match = re.search(r'\{[^{}]+\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return None


def _call_model(prompt: str, model: str, timeout: float) -> dict | None:
    """Chama um modelo específico e retorna o JSON parseado."""
    if not AI_API_KEY or not AI_ENABLED:
        return None

    is_reasoning = _is_reasoning(model)
    max_tokens   = 800 if is_reasoning else 150  # reasoning precisa de mais tokens para o <think>

    payload = json.dumps({
        'model':       model,
        'max_tokens':  max_tokens,
        'temperature': 0.1 if not is_reasoning else 0.6,  # reasoning funciona melhor com temp maior
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user',   'content': prompt}
        ]
    }).encode('utf-8')

    url = f"{AI_BASE_URL.rstrip('/')}/chat/completions"
    req = urllib.request.Request(url, data=payload, method='POST', headers={
        'Content-Type':  'application/json',
        'Authorization': f'Bearer {AI_API_KEY}',
    })

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data    = json.loads(resp.read().decode('utf-8'))
            content = data['choices'][0]['message']['content']
            return _extract_json(content)
    except (urllib.error.URLError, TimeoutError):
        return None
    except Exception as e:
        log.debug(f'  AI {model}: erro — {e}')
        return None


def _build_prompt(pair, side, price, indicators, signal_info, pair_stats, learning) -> str:
    """Prompt compacto com todos os dados de mercado relevantes."""
    rsi       = indicators.get('rsi', 50)
    ema21     = indicators.get('ema21', price)
    ema50     = indicators.get('ema50', price)
    atr_pct   = indicators.get('atr_pct', 0.2)
    vol_ratio = indicators.get('vol_ratio', 1.0)
    bb_pct_b  = indicators.get('bb_pct_b', 0.5)
    macd_hist = indicators.get('macd_hist', 0)
    regime    = indicators.get('regime', 'ranging')
    adx       = indicators.get('adx', 15)

    p_wins  = pair_stats.get('wins', 0)
    p_loss  = pair_stats.get('losses', 0)
    p_pnl   = pair_stats.get('pnl', 0.0)
    p_total = p_wins + p_loss
    p_wr    = f'{p_wins/p_total*100:.0f}%' if p_total > 0 else 'sem hist.'

    top_strats = sorted(
        [(s, d) for s, d in learning.items() if isinstance(d, dict) and d.get('n', 0) >= 8],
        key=lambda x: float(x[1].get('wr', 0) if x[1].get('wr') != 'N/A' else 0), reverse=True
    )[:3]
    strats_txt = ', '.join(f"{s}({d['wr']}%)" for s, d in top_strats) or 'sem dados'

    macro = 'ALTA' if price > ema50 * 1.001 else 'BAIXA' if price < ema50 * 0.999 else 'NEUTRO'
    vs_m  = 'A FAVOR' if (side=='BUY' and macro=='ALTA') or (side=='SELL' and macro=='BAIXA') else \
            'CONTRA'  if (side=='BUY' and macro=='BAIXA') or (side=='SELL' and macro=='ALTA') else 'NEUTRO'

    score  = signal_info.get('score', 0)
    count  = signal_info.get('count', 0)
    strats = ', '.join(signal_info.get('strategies', []))
    reason = signal_info.get('reason', '')
    conf   = signal_info.get('confidence', 0.5)
    tp_p   = signal_info.get('tp_pct', 0.4)
    sl_p   = signal_info.get('sl_pct', 0.2)
    rr     = tp_p / sl_p if sl_p > 0 else 0

    return (
        f"PAR: {pair} | LADO: {side} | PREÇO: ${price:,.4f}\n"
        f"Regime: {regime} | ADX: {adx:.0f} | Macro: {macro} | vs macro: {vs_m}\n"
        f"RSI: {rsi:.1f} | BB%B: {bb_pct_b:.2f} | MACD hist: {macd_hist:+.5f}\n"
        f"EMA21: ${ema21:,.4f} | EMA50: ${ema50:,.4f} | ATR: {atr_pct:.3f}% | Vol: {vol_ratio:.1f}x\n"
        f"Score: {score:.1f} | Sinais: {count} | Estratégias: {strats}\n"
        f"Motivo: {reason} | Conf engine: {conf:.0%}\n"
        f"TP: +{tp_p:.3f}% | SL: -{sl_p:.3f}% | R:R: 1:{rr:.2f}\n"
        f"Par hoje: {p_wins}W/{p_loss}L WR:{p_wr} PnL:${p_pnl:+.4f}\n"
        f"Top estratégias (WR): {strats_txt}"
    )


def _normalize_result(raw: dict, model: str) -> dict:
    """Normaliza e valida a resposta da IA."""
    decision   = str(raw.get('decision', 'ENTER')).upper()
    if decision not in ('ENTER', 'SKIP', 'REDUCE'): decision = 'ENTER'
    confidence = float(raw.get('confidence', 0.7))
    tp_mult    = max(0.7, min(2.0, float(raw.get('tp_mult', 1.0))))
    sl_mult    = max(0.7, min(1.5, float(raw.get('sl_mult', 1.0))))
    reason     = str(raw.get('reason', ''))[:80]
    risk_level = str(raw.get('risk_level', 'MEDIUM')).upper()
    if risk_level not in ('LOW', 'MEDIUM', 'HIGH'): risk_level = 'MEDIUM'

    # Aplica limiar de confiança mínima
    if decision == 'ENTER' and confidence < AI_MIN_CONF:
        decision = 'REDUCE'
        reason   = f'conf {confidence:.0%} < mín {AI_MIN_CONF:.0%}'

    return {
        'decision':   decision,
        'confidence': round(confidence, 3),
        'tp_mult':    round(tp_mult, 2),
        'sl_mult':    round(sl_mult, 2),
        'reason':     reason,
        'risk_level': risk_level,
        'model_used': model,
    }


# ── Classe Principal ──────────────────────────────────────────────────────────

class HFTAIAdvisor:
    def __init__(self):
        self._cache       = {}
        self._lock        = threading.Lock()
        self._calls_fast  = 0
        self._calls_deep  = 0
        self._approved    = 0
        self._skipped     = 0
        self._timeouts    = 0
        self._lat_fast    = deque(maxlen=50)
        self._lat_deep    = deque(maxlen=20)

        if AI_ENABLED:
            log.info(
                f'  🤖 AI Advisor v2.0 ativo\n'
                f'     FAST: {AI_MODEL_FAST} (timeout {AI_TIMEOUT_FAST}s)\n'
                f'     DEEP: {AI_MODEL_DEEP} (timeout {AI_TIMEOUT_DEEP}s, ativado no REDUCE)\n'
                f'     Confiança mínima: {AI_MIN_CONF:.0%}'
            )

    @property
    def enabled(self) -> bool:
        return AI_ENABLED and bool(AI_API_KEY)

    def validate(self, pair, side, price, indicators, signal_info, pair_stats, learning) -> dict:
        """
        Fluxo de dois estágios:
          1. Chama modelo FAST (deepseek-v3) — rápido, decide em <4s
          2. Se FAST retorna REDUCE → consulta modelo DEEP (deepseek-r1) para desempate
        """
        if not self.enabled:
            return self._fallback('IA desabilitada')

        # Cache por par+side+preço arredondado
        cache_key = f'{pair}_{side}_{price:.1f}'
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached and (time.time() - cached['ts']) < AI_CACHE_TTL:
                r = cached['result'].copy(); r['source'] = 'cache'
                return r

        prompt = _build_prompt(pair, side, price, indicators, signal_info, pair_stats, learning)

        # ── Estágio 1: modelo FAST ────────────────────────────────────────────
        t0      = time.time()
        raw_fast = self._call_threaded(prompt, AI_MODEL_FAST, AI_TIMEOUT_FAST)
        lat_fast = time.time() - t0
        self._calls_fast += 1
        self._lat_fast.append(lat_fast)

        if raw_fast is None:
            self._timeouts += 1
            log.debug(f'  🤖 FAST timeout {pair} ({lat_fast:.1f}s) → fallback')
            return self._fallback(f'timeout {lat_fast:.1f}s')

        result_fast = _normalize_result(raw_fast, AI_MODEL_FAST)
        result_fast['latency'] = round(lat_fast, 2)
        result_fast['source']  = 'ai_fast'

        icon_f = '✅' if result_fast['decision'] == 'ENTER' else \
                 '⚠️' if result_fast['decision'] == 'REDUCE' else '🚫'
        log.info(
            f'  🤖 FAST {icon_f} {result_fast["decision"]} {pair} {side} '
            f'conf={result_fast["confidence"]:.0%} risco={result_fast["risk_level"]} '
            f'| {result_fast["reason"]} ({lat_fast:.1f}s)'
        )

        # ── Estágio 2: modelo DEEP só se FAST hesitou (REDUCE) ───────────────
        final_result = result_fast
        if result_fast['decision'] == 'REDUCE' and AI_MODEL_DEEP != AI_MODEL_FAST:
            log.info(f'  🧠 FAST hesitou — consultando DEEP ({AI_MODEL_DEEP})...')
            t1      = time.time()
            raw_deep = self._call_threaded(prompt, AI_MODEL_DEEP, AI_TIMEOUT_DEEP)
            lat_deep = time.time() - t1
            self._calls_deep += 1
            self._lat_deep.append(lat_deep)

            if raw_deep is not None:
                result_deep = _normalize_result(raw_deep, AI_MODEL_DEEP)
                result_deep['latency']   = round(lat_fast + lat_deep, 2)
                result_deep['source']    = 'ai_deep'
                result_deep['fast_said'] = result_fast['decision']

                icon_d = '✅' if result_deep['decision'] == 'ENTER' else \
                         '⚠️' if result_deep['decision'] == 'REDUCE' else '🚫'
                log.info(
                    f'  🧠 DEEP {icon_d} {result_deep["decision"]} {pair} {side} '
                    f'conf={result_deep["confidence"]:.0%} '
                    f'| {result_deep["reason"]} ({lat_deep:.1f}s)'
                )
                final_result = result_deep
            else:
                log.debug(f'  🧠 DEEP timeout ({lat_deep:.1f}s) → mantém decisão FAST')
                # FAST disse REDUCE e DEEP falhou → entra com REDUCE mesmo
                final_result = result_fast

        # Atualiza contadores
        if final_result['decision'] in ('ENTER', 'REDUCE'):
            self._approved += 1
        else:
            self._skipped += 1

        # Atualiza cache
        with self._lock:
            self._cache[cache_key] = {'ts': time.time(), 'result': final_result}
            if len(self._cache) > 60:
                oldest = sorted(self._cache.items(), key=lambda x: x[1]['ts'])[:15]
                for k, _ in oldest: del self._cache[k]

        return final_result

    def _call_threaded(self, prompt: str, model: str, timeout: float) -> dict | None:
        """Chama o modelo em thread separada com timeout rígido."""
        result = [None]
        def _do():
            result[0] = _call_model(prompt, model, timeout)
        t = threading.Thread(target=_do, daemon=True)
        t.start()
        t.join(timeout=timeout + 1.0)
        return result[0]

    def _fallback(self, reason='') -> dict:
        return {
            'decision': 'FALLBACK', 'confidence': 0.6,
            'tp_mult': 1.0, 'sl_mult': 1.0,
            'reason': reason or 'IA indisponível',
            'risk_level': 'MEDIUM', 'latency': 0.0,
            'source': 'fallback', 'model_used': 'none',
        }

    def get_stats(self) -> dict:
        total_calls = self._calls_fast + self._calls_deep
        avg_fast = sum(self._lat_fast) / len(self._lat_fast) if self._lat_fast else 0
        avg_deep = sum(self._lat_deep) / len(self._lat_deep) if self._lat_deep else 0
        return {
            'enabled':        self.enabled,
            'model_fast':     AI_MODEL_FAST,
            'model_deep':     AI_MODEL_DEEP,
            'calls_fast':     self._calls_fast,
            'calls_deep':     self._calls_deep,
            'approved':       self._approved,
            'skipped':        self._skipped,
            'timeouts':       self._timeouts,
            'skip_rate':      round(self._skipped / total_calls * 100, 1) if total_calls > 0 else 0,
            'avg_lat_fast_s': round(avg_fast, 2),
            'avg_lat_deep_s': round(avg_deep, 2),
        }


# ── Singleton ─────────────────────────────────────────────────────────────────
_advisor: HFTAIAdvisor = None

def get_ai_advisor() -> HFTAIAdvisor:
    global _advisor
    if _advisor is None:
        _advisor = HFTAIAdvisor()
    return _advisor
