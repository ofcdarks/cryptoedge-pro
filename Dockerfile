# ── CryptoEdge Pro v3.0 — Production Dockerfile ──────────────────────────────
FROM node:20-alpine

WORKDIR /app

# System deps
RUN apk add --no-cache \
    curl \
    python3 \
    py3-pip \
    bash \
    tzdata \
    && ln -sf python3 /usr/bin/python \
    && cp /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
    && echo "America/Sao_Paulo" > /etc/timezone

# Instala PM2
RUN npm install -g pm2 --no-audit --no-fund && pm2 --version

# Dependências Python do bot
COPY bot/requirements.txt ./bot/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir \
    python-binance \
    python-dotenv \
    requests \
    websockets \
  || pip3 install --no-cache-dir \
    python-binance \
    python-dotenv \
    requests \
    websockets

# Dependências Node (produção)
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Copia código-fonte
COPY . .

# Diretórios de dados
RUN mkdir -p /data /app/logs && chmod 777 /data /app/logs

# Variáveis padrão
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data \
    TZ=America/Sao_Paulo

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -sf http://localhost:3000/api/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "server.js"]