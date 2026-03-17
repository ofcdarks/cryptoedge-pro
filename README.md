# CryptoEdge Pro v3.0

Plataforma profissional de day trade de criptomoedas com IA, HFT Bot e gestão de risco.

## Deploy no EasyPanel

### 1. Clonar / Upload do código
Faça upload do ZIP no EasyPanel ou conecte ao repositório Git.

### 2. Variáveis de ambiente obrigatórias

| Variável | Descrição |
|---|---|
| `ENCRYPTION_KEY` | Chave 32 chars para criptografia: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` |
| `ALLOWED_ORIGIN` | URL do seu domínio: `https://cryptoedge.seusite.com` |
| `LAOZHANG_API_KEY` | Chave da API de IA (laozhang.ai) |
| `BINANCE_API_KEY` | Chave API da Binance |
| `BINANCE_SECRET_KEY` | Secret da Binance |
| `TELEGRAM_TOKEN` | Token do bot Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat Telegram |

### 3. Volume persistente
Configure um volume no EasyPanel: `/data` → persiste o banco de dados SQLite.

### 4. Primeiro acesso
Acesse `https://seu-dominio.com` → crie a conta admin na tela inicial.

## Estratégias do Bot

| Estratégia | Timeframe recomendado | Descrição |
|---|---|---|
| `pattern` | 15m | Pattern recognition (padrão) |
| `trend` | 1h | EMA crossover |
| `macd` | 15m-1h | MACD divergência |
| `breakout` | 4h | Rompimento de suporte/resistência |
| `scalping` | 1m | Scalp RSI extremos |
| `hft` | 1m | **Alta frequência** — 20-80 trades/dia |

## HFT Bot

Para ativar o modo de alta frequência:
```
BOT_STRATEGY=hft
BOT_TRADE_MODE=auto
BOT_TESTNET=true   ← SEMPRE testar antes!
HFT_TP_PCT=0.35
HFT_SL_PCT=0.18
HFT_RISK_PCT=1.5
HFT_DAILY_LOSS=3.0
HFT_PAIRS=BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT
```

## Requisitos
- Node.js 20+
- Python 3.11+
- Docker (via EasyPanel)
