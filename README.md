# CryptoEdge Pro 🚀

Plataforma profissional de day trade de criptomoedas com:
- Dashboard ao vivo com preços via WebSocket da Binance
- Calculadora de alavancagem e liquidação
- Gestão de risco / position sizing
- Grid Bot configurável com geração de código Python
- Checklist diário pré-operação
- Diário de trades com banco de dados SQLite
- IA Expert (Claude) para análise e estratégia

---

## Requisitos

- Node.js 20+
- Python 3.10+
- Docker + Docker Compose (para deploy)

---

## Configuração local

```bash
# 1. Clone o repositório
git clone https://github.com/SEUUSUARIO/cryptoedge-pro.git
cd cryptoedge-pro

# 2. Copie e edite as variáveis de ambiente
cp .env.example .env
nano .env

# 3. Instale dependências Node
npm install

# 4. Instale dependências Python (para o bot)
pip3 install -r bot/requirements.txt

# 5. Inicie o servidor
npm start

# Acesse: http://localhost:3000
```

---

## Deploy com Docker Compose (VPS)

```bash
# 1. Clone na VPS
git clone https://github.com/SEUUSUARIO/cryptoedge-pro.git
cd cryptoedge-pro

# 2. Configure o .env
cp .env.example .env
nano .env  # Preencha as chaves

# 3. Suba o app
docker compose up -d --build

# 4. Ver logs
docker compose logs -f web

# 5. Para subir o bot também:
docker compose --profile bot up -d
```

---

## Deploy no EasyPanel

1. No EasyPanel, crie um novo **App** do tipo **Git + Dockerfile**
2. Aponte para seu repositório GitHub
3. Branch: `main`
4. Dockerfile: `./Dockerfile`
5. Porta: `3000`
6. Configure as variáveis de ambiente:
   - `LAOZHANG_API_KEY` — sua chave da laozhang.ai
   - `BINANCE_API_KEY` — chave da Binance (leitura + negociação)
   - `BINANCE_SECRET_KEY` — secret da Binance
   - `PORT` — `3000`
7. Volume: monte `/data` como volume persistente
8. Clique em **Deploy**

### Domínio personalizado no EasyPanel

1. Em **Domains**, adicione `seudominio.com.br`
2. Aponte o DNS para o IP da VPS (registro A)
3. O EasyPanel provisiona o SSL automaticamente via Let's Encrypt

---

## Deploy manual na VPS (Ubuntu 22.04)

```bash
# Instalar Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

# Instalar Nginx
apt install nginx certbot python3-certbot-nginx -y

# Configurar Nginx
cat > /etc/nginx/sites-available/cryptoedge << 'EOF'
server {
    listen 80;
    server_name seudominio.com.br;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -s /etc/nginx/sites-available/cryptoedge /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# SSL gratuito com Let's Encrypt
certbot --nginx -d seudominio.com.br

# Subir a aplicação
cd /opt/cryptoedge-pro
docker compose up -d --build
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `LAOZHANG_API_KEY` | Sim (para IA) | Chave da laozhang.ai (qwen3-30b-a3b) |
| `BINANCE_API_KEY` | Sim (para bot) | API Key da Binance |
| `BINANCE_SECRET_KEY` | Sim (para bot) | Secret Key da Binance |
| `PORT` | Não | Porta do servidor (padrão: 3000) |
| `DB_PATH` | Não | Caminho do banco SQLite |
| `BOT_TESTNET` | Não | `true` para modo teste |

---

## Segurança

- **Nunca** ative permissão de **Saque** na API Key da Binance
- **Nunca** commite o arquivo `.env` no Git
- Use o Bot com `BOT_TESTNET=true` antes de operar com dinheiro real
- Mantenha Docker e Node.js sempre atualizados

---

## Stack

- **Backend**: Node.js 20 + Express + WebSocket
- **Banco de dados**: SQLite (better-sqlite3)
- **Frontend**: HTML5 + CSS3 + JavaScript vanilla
- **Gráfico**: TradingView Widget
- **Preços ao vivo**: Binance WebSocket API
- **IA**: laozhang.ai Claude (claude-sonnet-4-20250514)
- **Bot**: Python 3 + python-binance
- **Container**: Docker + Docker Compose

---

## Aviso Legal

Este software é educacional. Day trade envolve alto risco de perda de capital. Nunca invista mais do que pode perder. O autor não se responsabiliza por perdas financeiras.
