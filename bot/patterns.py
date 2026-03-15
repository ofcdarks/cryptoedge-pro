"""
CryptoEdge Pro — Motor de Padrões v1.0
Reconhece padrões de velas japonesas, padrões de gráfico (price action)
e gera predições para o próximo movimento.
"""

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from enum import Enum


class Signal(Enum):
    STRONG_BUY  = "STRONG_BUY"
    BUY         = "BUY"
    NEUTRAL     = "NEUTRAL"
    SELL        = "SELL"
    STRONG_SELL = "STRONG_SELL"


@dataclass
class Candle:
    open:   float
    high:   float
    low:    float
    close:  float
    volume: float = 0.0

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def body_pct(self) -> float:
        return self.body / self.open * 100 if self.open else 0

    @property
    def upper_wick(self) -> float:
        return self.high - max(self.open, self.close)

    @property
    def lower_wick(self) -> float:
        return min(self.open, self.close) - self.low

    @property
    def total_range(self) -> float:
        return self.high - self.low

    @property
    def is_bullish(self) -> bool:
        return self.close >= self.open

    @property
    def is_bearish(self) -> bool:
        return self.close < self.open

    @property
    def is_doji(self) -> bool:
        return self.body_pct < 0.1 and self.total_range > 0

    @property
    def mid(self) -> float:
        return (self.open + self.close) / 2


@dataclass
class PatternResult:
    name:        str
    signal:      Signal
    confidence:  float          # 0.0 – 1.0
    description: str
    candles_used: int = 1
    target_pct:  float = 0.0   # alvo de preço estimado em %
    stop_pct:    float = 0.0   # stop sugerido em %

    def emoji(self) -> str:
        m = {
            Signal.STRONG_BUY:  "🚀",
            Signal.BUY:         "🟢",
            Signal.NEUTRAL:     "⚪",
            Signal.SELL:        "🔴",
            Signal.STRONG_SELL: "💀",
        }
        return m.get(self.signal, "⚪")

    def __str__(self):
        return (f"{self.emoji()} [{self.name}] {self.signal.value} "
                f"conf={self.confidence:.0%} alvo={self.target_pct:+.1f}% "
                f"stop={self.stop_pct:.1f}%")


# ─────────────────────────────────────────────────────────────────────────────
# PADRÕES DE VELA JAPONESA (1-3 velas)
# ─────────────────────────────────────────────────────────────────────────────

def _avg_body(candles: List[Candle]) -> float:
    bodies = [c.body for c in candles if c.body > 0]
    return sum(bodies) / len(bodies) if bodies else 1e-9


def detect_doji(c: Candle, avg_body: float) -> Optional[PatternResult]:
    if not c.is_doji:
        return None
    has_long_wicks = (c.upper_wick + c.lower_wick) > avg_body * 2
    return PatternResult(
        name="Doji",
        signal=Signal.NEUTRAL,
        confidence=0.6,
        description="Indecisão — comprador e vendedor empataram. Aguarde confirmação.",
        target_pct=0, stop_pct=0.5
    )


def detect_dragonfly_doji(c: Candle) -> Optional[PatternResult]:
    if c.body_pct > 0.15:
        return None
    if c.lower_wick < c.total_range * 0.6:
        return None
    if c.upper_wick > c.total_range * 0.1:
        return None
    return PatternResult(
        name="Dragonfly Doji",
        signal=Signal.BUY,
        confidence=0.72,
        description="Vendedores rejeitados na mínima — possível reversão de alta.",
        target_pct=1.5, stop_pct=0.8
    )


def detect_gravestone_doji(c: Candle) -> Optional[PatternResult]:
    if c.body_pct > 0.15:
        return None
    if c.upper_wick < c.total_range * 0.6:
        return None
    if c.lower_wick > c.total_range * 0.1:
        return None
    return PatternResult(
        name="Gravestone Doji",
        signal=Signal.SELL,
        confidence=0.72,
        description="Compradores rejeitados na máxima — possível reversão de baixa.",
        target_pct=-1.5, stop_pct=0.8
    )


def detect_hammer(c: Candle, trend: str, avg_body: float) -> Optional[PatternResult]:
    if c.body < avg_body * 0.3:
        return None
    if c.lower_wick < c.body * 2:
        return None
    if c.upper_wick > c.body * 0.5:
        return None
    if trend == 'down':
        return PatternResult(
            name="Hammer",
            signal=Signal.BUY,
            confidence=0.74,
            description="Martelo em tendência de baixa — rejeição da mínima, reversão provável.",
            target_pct=2.0, stop_pct=1.0
        )
    return None


def detect_inverted_hammer(c: Candle, trend: str, avg_body: float) -> Optional[PatternResult]:
    if c.body < avg_body * 0.3:
        return None
    if c.upper_wick < c.body * 2:
        return None
    if c.lower_wick > c.body * 0.5:
        return None
    if trend == 'down':
        return PatternResult(
            name="Inverted Hammer",
            signal=Signal.BUY,
            confidence=0.62,
            description="Martelo invertido — compradores tentaram reversão, aguarde confirmação.",
            target_pct=1.8, stop_pct=1.0
        )
    return None


def detect_shooting_star(c: Candle, trend: str, avg_body: float) -> Optional[PatternResult]:
    if c.body < avg_body * 0.3:
        return None
    if c.upper_wick < c.body * 2:
        return None
    if c.lower_wick > c.body * 0.5:
        return None
    if trend == 'up':
        return PatternResult(
            name="Shooting Star",
            signal=Signal.SELL,
            confidence=0.74,
            description="Estrela cadente em topo — compradores recusados, venda provável.",
            target_pct=-2.0, stop_pct=1.0
        )
    return None


def detect_hanging_man(c: Candle, trend: str, avg_body: float) -> Optional[PatternResult]:
    if c.body < avg_body * 0.3:
        return None
    if c.lower_wick < c.body * 2:
        return None
    if c.upper_wick > c.body * 0.5:
        return None
    if trend == 'up':
        return PatternResult(
            name="Hanging Man",
            signal=Signal.SELL,
            confidence=0.65,
            description="Homem enforcado em topo — sinal de exaustão compradora.",
            target_pct=-1.5, stop_pct=1.0
        )
    return None


def detect_marubozu(c: Candle, avg_body: float) -> Optional[PatternResult]:
    if c.body < avg_body * 2:
        return None
    wick_ratio = (c.upper_wick + c.lower_wick) / c.body
    if wick_ratio > 0.1:
        return None
    if c.is_bullish:
        return PatternResult(
            name="Marubozu Altista",
            signal=Signal.STRONG_BUY,
            confidence=0.82,
            description="Vela cheia de alta sem sombras — dominância total dos compradores.",
            target_pct=2.5, stop_pct=1.5
        )
    return PatternResult(
        name="Marubozu Baixista",
        signal=Signal.STRONG_SELL,
        confidence=0.82,
        description="Vela cheia de baixa sem sombras — dominância total dos vendedores.",
        target_pct=-2.5, stop_pct=1.5
    )


def detect_spinning_top(c: Candle, avg_body: float) -> Optional[PatternResult]:
    if c.body > avg_body * 0.7:
        return None
    if c.upper_wick < c.body * 0.5 or c.lower_wick < c.body * 0.5:
        return None
    return PatternResult(
        name="Spinning Top",
        signal=Signal.NEUTRAL,
        confidence=0.5,
        description="Peão — indecisão com sombras equilibradas. Mercado sem direção clara.",
        target_pct=0, stop_pct=0.5
    )


# ── 2 velas ───────────────────────────────────────────────────────────────────

def detect_engulfing(c1: Candle, c2: Candle) -> Optional[PatternResult]:
    if c1.is_bearish and c2.is_bullish:
        if c2.open < c1.close and c2.close > c1.open:
            return PatternResult(
                name="Engolfamento Altista",
                signal=Signal.STRONG_BUY,
                confidence=0.80,
                description="Vela altista engloba a vela baixista anterior — reversão forte.",
                candles_used=2, target_pct=2.5, stop_pct=1.2
            )
    if c1.is_bullish and c2.is_bearish:
        if c2.open > c1.close and c2.close < c1.open:
            return PatternResult(
                name="Engolfamento Baixista",
                signal=Signal.STRONG_SELL,
                confidence=0.80,
                description="Vela baixista engloba a vela altista anterior — reversão forte.",
                candles_used=2, target_pct=-2.5, stop_pct=1.2
            )
    return None


def detect_harami(c1: Candle, c2: Candle, avg_body: float) -> Optional[PatternResult]:
    if c2.body > c1.body * 0.5:
        return None
    if c2.high > c1.high or c2.low < c1.low:
        return None
    if c1.is_bearish and c2.is_bullish:
        return PatternResult(
            name="Harami Altista",
            signal=Signal.BUY,
            confidence=0.65,
            description="Vela pequena dentro da baixista anterior — possível reversão.",
            candles_used=2, target_pct=1.5, stop_pct=1.0
        )
    if c1.is_bullish and c2.is_bearish:
        return PatternResult(
            name="Harami Baixista",
            signal=Signal.SELL,
            confidence=0.65,
            description="Vela pequena dentro da altista anterior — possível reversão.",
            candles_used=2, target_pct=-1.5, stop_pct=1.0
        )
    return None


def detect_piercing_dark_cloud(c1: Candle, c2: Candle) -> Optional[PatternResult]:
    # Piercing Line (alta)
    if c1.is_bearish and c2.is_bullish:
        if c2.open < c1.low and c2.close > c1.mid and c2.close < c1.open:
            return PatternResult(
                name="Piercing Line",
                signal=Signal.BUY,
                confidence=0.70,
                description="Linha penetrante — compradores recuperaram mais de 50% da vela baixista.",
                candles_used=2, target_pct=2.0, stop_pct=1.0
            )
    # Dark Cloud Cover (baixa)
    if c1.is_bullish and c2.is_bearish:
        if c2.open > c1.high and c2.close < c1.mid and c2.close > c1.open:
            return PatternResult(
                name="Dark Cloud Cover",
                signal=Signal.SELL,
                confidence=0.70,
                description="Nuvem negra — vendedores cobriram mais de 50% da vela altista.",
                candles_used=2, target_pct=-2.0, stop_pct=1.0
            )
    return None


def detect_tweezer(c1: Candle, c2: Candle) -> Optional[PatternResult]:
    tol = (c1.high - c1.low) * 0.01
    # Tweezer Top
    if abs(c1.high - c2.high) < tol and c1.is_bullish and c2.is_bearish:
        return PatternResult(
            name="Tweezer Top",
            signal=Signal.SELL,
            confidence=0.68,
            description="Duas máximas iguais — resistência dupla, reversão provável.",
            candles_used=2, target_pct=-1.5, stop_pct=0.8
        )
    # Tweezer Bottom
    if abs(c1.low - c2.low) < tol and c1.is_bearish and c2.is_bullish:
        return PatternResult(
            name="Tweezer Bottom",
            signal=Signal.BUY,
            confidence=0.68,
            description="Duas mínimas iguais — suporte duplo, reversão provável.",
            candles_used=2, target_pct=1.5, stop_pct=0.8
        )
    return None


# ── 3 velas ───────────────────────────────────────────────────────────────────

def detect_morning_evening_star(c1: Candle, c2: Candle, c3: Candle, avg_body: float) -> Optional[PatternResult]:
    # Morning Star (reversão de alta)
    if (c1.is_bearish and c1.body > avg_body
            and c2.body < avg_body * 0.5
            and c3.is_bullish and c3.body > avg_body
            and c3.close > c1.mid):
        return PatternResult(
            name="Morning Star",
            signal=Signal.STRONG_BUY,
            confidence=0.84,
            description="Estrela da manhã — reversão poderosa de baixa para alta. Setup top.",
            candles_used=3, target_pct=3.0, stop_pct=1.5
        )
    # Evening Star (reversão de baixa)
    if (c1.is_bullish and c1.body > avg_body
            and c2.body < avg_body * 0.5
            and c3.is_bearish and c3.body > avg_body
            and c3.close < c1.mid):
        return PatternResult(
            name="Evening Star",
            signal=Signal.STRONG_SELL,
            confidence=0.84,
            description="Estrela da tarde — reversão poderosa de alta para baixa. Setup top.",
            candles_used=3, target_pct=-3.0, stop_pct=1.5
        )
    return None


def detect_three_soldiers_crows(c1: Candle, c2: Candle, c3: Candle, avg_body: float) -> Optional[PatternResult]:
    # Three White Soldiers
    if (c1.is_bullish and c2.is_bullish and c3.is_bullish
            and c2.open > c1.open and c2.close > c1.close
            and c3.open > c2.open and c3.close > c2.close
            and all(c.body > avg_body * 0.8 for c in [c1, c2, c3])
            and all(c.upper_wick < c.body * 0.3 for c in [c1, c2, c3])):
        return PatternResult(
            name="Three White Soldiers",
            signal=Signal.STRONG_BUY,
            confidence=0.88,
            description="3 soldados brancos — tendência de alta muito forte, momentum alto.",
            candles_used=3, target_pct=4.0, stop_pct=2.0
        )
    # Three Black Crows
    if (c1.is_bearish and c2.is_bearish and c3.is_bearish
            and c2.open < c1.open and c2.close < c1.close
            and c3.open < c2.open and c3.close < c2.close
            and all(c.body > avg_body * 0.8 for c in [c1, c2, c3])
            and all(c.lower_wick < c.body * 0.3 for c in [c1, c2, c3])):
        return PatternResult(
            name="Three Black Crows",
            signal=Signal.STRONG_SELL,
            confidence=0.88,
            description="3 corvos negros — tendência de baixa muito forte, venda dominante.",
            candles_used=3, target_pct=-4.0, stop_pct=2.0
        )
    return None


def detect_three_inside(c1: Candle, c2: Candle, c3: Candle) -> Optional[PatternResult]:
    # Three Inside Up
    harami_bull = (c1.is_bearish and c2.is_bullish
                   and c2.open > c1.close and c2.close < c1.open)
    if harami_bull and c3.is_bullish and c3.close > c1.open:
        return PatternResult(
            name="Three Inside Up",
            signal=Signal.BUY,
            confidence=0.75,
            description="Harami altista confirmado pela 3ª vela — reversão com confirmação.",
            candles_used=3, target_pct=2.0, stop_pct=1.2
        )
    # Three Inside Down
    harami_bear = (c1.is_bullish and c2.is_bearish
                   and c2.open < c1.close and c2.close > c1.open)
    if harami_bear and c3.is_bearish and c3.close < c1.open:
        return PatternResult(
            name="Three Inside Down",
            signal=Signal.SELL,
            confidence=0.75,
            description="Harami baixista confirmado pela 3ª vela — reversão com confirmação.",
            candles_used=3, target_pct=-2.0, stop_pct=1.2
        )
    return None


# ─────────────────────────────────────────────────────────────────────────────
# PADRÕES DE GRÁFICO (Price Action — múltiplas velas)
# ─────────────────────────────────────────────────────────────────────────────

def detect_double_top_bottom(candles: List[Candle], lookback: int = 20) -> Optional[PatternResult]:
    if len(candles) < lookback:
        return None
    window = candles[-lookback:]
    highs  = [c.high  for c in window]
    lows   = [c.low   for c in window]
    closes = [c.close for c in window]
    tol    = (max(highs) - min(lows)) * 0.015   # 1.5% de tolerância

    # Double Top
    top1_idx = highs.index(max(highs))
    if top1_idx < lookback - 5:
        remaining = highs[top1_idx+3:]
        if remaining:
            top2_val = max(remaining)
            if abs(top2_val - max(highs)) < tol:
                neck = min(lows[top1_idx:])
                if closes[-1] < neck * 1.001:
                    return PatternResult(
                        name="Double Top",
                        signal=Signal.STRONG_SELL,
                        confidence=0.82,
                        description=f"Topo duplo confirmado. Neckline: ${neck:,.0f}. Alvo = neckline - amplitude.",
                        candles_used=lookback, target_pct=-3.0, stop_pct=1.5
                    )

    # Double Bottom
    bot1_idx = lows.index(min(lows))
    if bot1_idx < lookback - 5:
        remaining = lows[bot1_idx+3:]
        if remaining:
            bot2_val = min(remaining)
            if abs(bot2_val - min(lows)) < tol:
                neck = max(highs[bot1_idx:])
                if closes[-1] > neck * 0.999:
                    return PatternResult(
                        name="Double Bottom",
                        signal=Signal.STRONG_BUY,
                        confidence=0.82,
                        description=f"Fundo duplo confirmado. Neckline: ${neck:,.0f}. Alvo = neckline + amplitude.",
                        candles_used=lookback, target_pct=3.0, stop_pct=1.5
                    )
    return None


def detect_head_shoulders(candles: List[Candle], lookback: int = 30) -> Optional[PatternResult]:
    if len(candles) < lookback:
        return None
    w      = candles[-lookback:]
    highs  = [c.high  for c in w]
    lows   = [c.low   for c in w]
    closes = [c.close for c in w]
    n      = len(highs)

    # Encontra 3 topos locais
    peaks = []
    for i in range(2, n - 2):
        if highs[i] > highs[i-1] and highs[i] > highs[i-2] and highs[i] > highs[i+1] and highs[i] > highs[i+2]:
            peaks.append((i, highs[i]))

    if len(peaks) >= 3:
        # Pega os 3 últimos topos
        p = peaks[-3:]
        l, m, r = p[0][1], p[1][1], p[2][1]
        tol = max(l, r) * 0.02
        if m > l and m > r and abs(l - r) < tol:
            # Neckline = mínima entre os topos
            neck = min(lows[p[0][0]:p[2][0]])
            if closes[-1] < neck:
                return PatternResult(
                    name="Head & Shoulders",
                    signal=Signal.STRONG_SELL,
                    confidence=0.85,
                    description=f"Ombro-Cabeça-Ombro confirmado. Rompeu neckline ${neck:,.0f}. Padrão clássico de reversão.",
                    candles_used=lookback, target_pct=-4.0, stop_pct=2.0
                )

    # Ombro-Cabeça-Ombro Invertido
    valleys = []
    for i in range(2, n - 2):
        if lows[i] < lows[i-1] and lows[i] < lows[i-2] and lows[i] < lows[i+1] and lows[i] < lows[i+2]:
            valleys.append((i, lows[i]))

    if len(valleys) >= 3:
        p = valleys[-3:]
        l, m, r = p[0][1], p[1][1], p[2][1]
        tol = min(l, r) * 0.02
        if m < l and m < r and abs(l - r) < tol:
            neck = max(highs[p[0][0]:p[2][0]])
            if closes[-1] > neck:
                return PatternResult(
                    name="Head & Shoulders Invertido",
                    signal=Signal.STRONG_BUY,
                    confidence=0.85,
                    description=f"OCO Invertido confirmado. Rompeu neckline ${neck:,.0f}. Reversão de alta poderosa.",
                    candles_used=lookback, target_pct=4.0, stop_pct=2.0
                )
    return None


def detect_triangle(candles: List[Candle], lookback: int = 20) -> Optional[PatternResult]:
    if len(candles) < lookback:
        return None
    w      = candles[-lookback:]
    highs  = [c.high  for c in w]
    lows   = [c.low   for c in w]
    closes = [c.close for c in w]
    n      = len(highs)

    # Regressão linear simples
    def linreg(vals):
        x  = list(range(len(vals)))
        mx = sum(x) / len(x)
        my = sum(vals) / len(vals)
        num = sum((x[i] - mx) * (vals[i] - my) for i in range(len(vals)))
        den = sum((x[i] - mx) ** 2 for i in range(len(vals)))
        slope = num / den if den else 0
        return slope

    slope_h = linreg(highs)
    slope_l = linreg(lows)
    last_c  = closes[-1]
    range_  = max(highs) - min(lows)

    # Triângulo simétrico — ambas inclinações convergem
    if slope_h < -range_ * 0.001 and slope_l > range_ * 0.001:
        apex   = (highs[0] + lows[0]) / 2
        if last_c > apex * 1.005:
            return PatternResult(
                name="Triângulo Simétrico (rompimento alta)",
                signal=Signal.BUY,
                confidence=0.72,
                description="Triângulo simétrico com rompimento para cima — entrada confirmada.",
                candles_used=lookback, target_pct=2.5, stop_pct=1.2
            )
        elif last_c < apex * 0.995:
            return PatternResult(
                name="Triângulo Simétrico (rompimento baixa)",
                signal=Signal.SELL,
                confidence=0.72,
                description="Triângulo simétrico com rompimento para baixo — entrada confirmada.",
                candles_used=lookback, target_pct=-2.5, stop_pct=1.2
            )

    # Triângulo Ascendente — topo plano, fundo subindo
    if abs(slope_h) < range_ * 0.0005 and slope_l > range_ * 0.001:
        resist = sum(highs) / len(highs)
        if last_c > resist * 1.003:
            return PatternResult(
                name="Triângulo Ascendente",
                signal=Signal.STRONG_BUY,
                confidence=0.78,
                description=f"Rompeu resistência ${resist:,.0f} do triângulo ascendente — continuação de alta.",
                candles_used=lookback, target_pct=3.0, stop_pct=1.5
            )

    # Triângulo Descendente — fundo plano, topo caindo
    if slope_h < -range_ * 0.001 and abs(slope_l) < range_ * 0.0005:
        support = sum(lows) / len(lows)
        if last_c < support * 0.997:
            return PatternResult(
                name="Triângulo Descendente",
                signal=Signal.STRONG_SELL,
                confidence=0.78,
                description=f"Rompeu suporte ${support:,.0f} do triângulo descendente — continuação de baixa.",
                candles_used=lookback, target_pct=-3.0, stop_pct=1.5
            )
    return None


def detect_flag_pennant(candles: List[Candle], lookback: int = 15) -> Optional[PatternResult]:
    if len(candles) < lookback + 5:
        return None

    pole   = candles[-(lookback+5):-lookback]
    flag   = candles[-lookback:]

    if len(pole) < 3:
        return None

    pole_move = (pole[-1].close - pole[0].open) / pole[0].open * 100

    flag_highs = [c.high  for c in flag]
    flag_lows  = [c.low   for c in flag]

    def linreg_slope(vals):
        n  = len(vals)
        x  = list(range(n))
        mx = sum(x) / n
        my = sum(vals) / n
        num = sum((x[i]-mx)*(vals[i]-my) for i in range(n))
        den = sum((x[i]-mx)**2 for i in range(n))
        return num/den if den else 0

    sh = linreg_slope(flag_highs)
    sl = linreg_slope(flag_lows)

    if abs(pole_move) < 3:
        return None

    # Bull Flag
    if pole_move > 3 and sh < 0 and sl < 0 and abs(sh - sl) < abs(sh) * 0.5:
        if candles[-1].close > flag_highs[-2]:
            return PatternResult(
                name="Bull Flag",
                signal=Signal.STRONG_BUY,
                confidence=0.80,
                description=f"Bandeira altista após alta de {pole_move:.1f}% — continuação esperada.",
                candles_used=lookback+5, target_pct=abs(pole_move)*0.6, stop_pct=1.5
            )

    # Bear Flag
    if pole_move < -3 and sh > 0 and sl > 0 and abs(sh - sl) < abs(sh) * 0.5:
        if candles[-1].close < flag_lows[-2]:
            return PatternResult(
                name="Bear Flag",
                signal=Signal.STRONG_SELL,
                confidence=0.80,
                description=f"Bandeira baixista após queda de {abs(pole_move):.1f}% — continuação esperada.",
                candles_used=lookback+5, target_pct=-abs(pole_move)*0.6, stop_pct=1.5
            )
    return None


def detect_wedge(candles: List[Candle], lookback: int = 20) -> Optional[PatternResult]:
    if len(candles) < lookback:
        return None
    w = candles[-lookback:]
    h = [c.high  for c in w]
    l = [c.low   for c in w]

    def slope(vals):
        n  = len(vals)
        x  = list(range(n))
        mx = sum(x) / n
        my = sum(vals) / n
        num = sum((x[i]-mx)*(vals[i]-my) for i in range(n))
        den = sum((x[i]-mx)**2 for i in range(n))
        return num/den if den else 0

    sh = slope(h)
    sl = slope(l)
    rng = max(h) - min(l)

    # Rising Wedge (baixista)
    if sh > rng * 0.0005 and sl > rng * 0.0005 and sh < sl * 0.9:
        return PatternResult(
            name="Rising Wedge",
            signal=Signal.SELL,
            confidence=0.73,
            description="Cunha de alta — convergência bearish. Rompimento para baixo esperado.",
            candles_used=lookback, target_pct=-2.5, stop_pct=1.5
        )

    # Falling Wedge (altista)
    if sh < -rng * 0.0005 and sl < -rng * 0.0005 and sh > sl * 0.9:
        return PatternResult(
            name="Falling Wedge",
            signal=Signal.BUY,
            confidence=0.73,
            description="Cunha de baixa — convergência bullish. Rompimento para cima esperado.",
            candles_used=lookback, target_pct=2.5, stop_pct=1.5
        )
    return None


# ─────────────────────────────────────────────────────────────────────────────
# PREDIÇÃO DO PRÓXIMO MOVIMENTO
# ─────────────────────────────────────────────────────────────────────────────

def predict_next_move(candles: List[Candle], patterns: List[PatternResult]) -> dict:
    """
    Combina todos os padrões detectados, volume e momentum
    para prever o próximo movimento provável.
    """
    if not candles:
        return {'direction': 'neutral', 'confidence': 0, 'target_pct': 0, 'reasoning': []}

    # Score ponderado por confiança
    score     = 0.0
    total_w   = 0.0
    reasoning = []

    for p in patterns:
        w = p.confidence
        v = {
            Signal.STRONG_BUY:  2.0,
            Signal.BUY:         1.0,
            Signal.NEUTRAL:     0.0,
            Signal.SELL:       -1.0,
            Signal.STRONG_SELL:-2.0,
        }.get(p.signal, 0)
        score   += v * w
        total_w += w
        reasoning.append(f"{p.emoji()} {p.name} (conf {p.confidence:.0%})")

    # Volume confirma movimento
    if len(candles) >= 5:
        vols   = [c.volume for c in candles[-5:]]
        avg_v  = sum(vols[:-1]) / (len(vols)-1) if len(vols) > 1 else vols[-1]
        last_v = vols[-1]
        if last_v > avg_v * 1.3:
            score   *= 1.2
            reasoning.append(f"📊 Volume acima da média ({last_v/avg_v:.1f}x) — confirma movimento")
        elif last_v < avg_v * 0.7:
            score   *= 0.8
            reasoning.append(f"📊 Volume fraco ({last_v/avg_v:.1f}x) — sinal menos confiável")

    # Momentum (últimas 3 velas)
    if len(candles) >= 3:
        closes = [c.close for c in candles[-3:]]
        mom    = (closes[-1] - closes[0]) / closes[0] * 100
        if abs(mom) > 1:
            reasoning.append(f"📈 Momentum: {mom:+.2f}% nas últimas 3 velas")

    if total_w == 0:
        return {'direction': 'neutral', 'confidence': 0.0, 'target_pct': 0.0, 'reasoning': reasoning}

    norm_score = score / total_w  # -2 a +2
    confidence = min(abs(norm_score) / 2, 1.0)

    if norm_score > 0.5:
        direction = 'up'
        target    = sum(p.target_pct for p in patterns if p.target_pct > 0) / max(1, len([p for p in patterns if p.target_pct > 0]))
    elif norm_score < -0.5:
        direction = 'down'
        target    = sum(p.target_pct for p in patterns if p.target_pct < 0) / max(1, len([p for p in patterns if p.target_pct < 0]))
    else:
        direction = 'neutral'
        target    = 0.0

    return {
        'direction':  direction,
        'confidence': confidence,
        'target_pct': target,
        'score':      norm_score,
        'reasoning':  reasoning
    }


# ─────────────────────────────────────────────────────────────────────────────
# ENGINE PRINCIPAL
# ─────────────────────────────────────────────────────────────────────────────

def run_all(candles: List[Candle], trend: str = 'neutral') -> Tuple[List[PatternResult], dict]:
    """
    Executa todos os detectores em cascata.
    Retorna (lista_de_padrões, predição_próximo_movimento).
    """
    found = []
    if len(candles) < 3:
        return found, predict_next_move(candles, found)

    c = candles  # alias
    avg = _avg_body(c[-10:]) if len(c) >= 10 else _avg_body(c)

    # ── Single candle ──────────────────────────────────────────────
    last = c[-1]
    for fn in [
        lambda: detect_dragonfly_doji(last),
        lambda: detect_gravestone_doji(last),
        lambda: detect_hammer(last, trend, avg),
        lambda: detect_inverted_hammer(last, trend, avg),
        lambda: detect_shooting_star(last, trend, avg),
        lambda: detect_hanging_man(last, trend, avg),
        lambda: detect_marubozu(last, avg),
        lambda: detect_spinning_top(last, avg),
        lambda: detect_doji(last, avg),
    ]:
        r = fn()
        if r:
            found.append(r)

    # ── 2 candles ──────────────────────────────────────────────────
    if len(c) >= 2:
        c1, c2 = c[-2], c[-1]
        for fn in [
            lambda: detect_engulfing(c1, c2),
            lambda: detect_harami(c1, c2, avg),
            lambda: detect_piercing_dark_cloud(c1, c2),
            lambda: detect_tweezer(c1, c2),
        ]:
            r = fn()
            if r:
                found.append(r)

    # ── 3 candles ──────────────────────────────────────────────────
    if len(c) >= 3:
        c1, c2, c3 = c[-3], c[-2], c[-1]
        for fn in [
            lambda: detect_morning_evening_star(c1, c2, c3, avg),
            lambda: detect_three_soldiers_crows(c1, c2, c3, avg),
            lambda: detect_three_inside(c1, c2, c3),
        ]:
            r = fn()
            if r:
                found.append(r)

    # ── Chart patterns ─────────────────────────────────────────────
    for fn in [
        lambda: detect_double_top_bottom(c, 20),
        lambda: detect_head_shoulders(c, 30),
        lambda: detect_triangle(c, 20),
        lambda: detect_flag_pennant(c, 12),
        lambda: detect_wedge(c, 20),
    ]:
        r = fn()
        if r:
            found.append(r)

    # Ordena por confiança decrescente
    found.sort(key=lambda x: x.confidence, reverse=True)

    prediction = predict_next_move(candles, found)
    return found, prediction
