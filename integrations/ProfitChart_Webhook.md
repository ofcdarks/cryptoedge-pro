# 📊 Integração ProfitChart / TradersClub → CryptoEdge Pro

## Configuração do Webhook

O CryptoEdge Pro aceita sinais via HTTP POST no endpoint:
```
POST https://seudominio.com/api/webhook/signal
Headers: x-api-key: SUA_BINANCE_API_KEY
Content-Type: application/json
```

## Formato do payload

```json
{
  "symbol":    "BTCUSDT",
  "direction": "Long",
  "entry":     71000.00,
  "exit":      72500.00,
  "size":      500.00,
  "leverage":  10,
  "pnl":       21.28,
  "pnl_pct":   3.01,
  "result":    "win",
  "reason":    "Sinal ProfitChart"
}
```

## Campos
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| symbol | string | ✅ | Ex: BTCUSDT, ETHUSDT |
| direction | string | ✅ | "Long" ou "Short" |
| entry | number | | Preço de entrada |
| exit | number | | Preço de saída (null se em aberto) |
| size | number | | Tamanho em USDT |
| leverage | number | | Alavancagem usada |
| pnl | number | | Lucro/Prejuízo em USDT |
| pnl_pct | number | | PnL em % |
| result | string | | "win", "loss" ou "pending" |
| reason | string | | Motivo/estratégia |

## Autenticação
Use sua **Binance API Key** como chave de autenticação.
Configure em: **Meu Perfil → Chaves de API → Binance API Key**

## Obter sua URL do webhook
Acesse: `https://seudominio.com/api/webhook/my-key` (autenticado)

## Exemplo com cURL
```bash
curl -X POST https://seudominio.com/api/webhook/signal \
  -H "Content-Type: application/json" \
  -H "x-api-key: SUA_BINANCE_API_KEY" \
  -d '{
    "symbol": "BTCUSDT",
    "direction": "Long",
    "entry": 71000,
    "exit": 72500,
    "size": 500,
    "result": "win",
    "pnl": 10.71
  }'
```

## Integração com Python (ProfitChart scripts)
```python
import requests

WEBHOOK_URL = "https://seudominio.com/api/webhook/signal"
API_KEY     = "SUA_BINANCE_API_KEY"

def send_trade(symbol, direction, entry, exit_price=None, pnl=0, result="pending"):
    r = requests.post(WEBHOOK_URL,
        headers={"x-api-key": API_KEY, "Content-Type": "application/json"},
        json={"symbol": symbol, "direction": direction, "entry": entry,
              "exit": exit_price, "pnl": pnl, "result": result, "reason": "ProfitChart"}
    )
    return r.json()

# Exemplo de uso
send_trade("BTCUSDT", "Long", 71000, 72500, 10.71, "win")
```
