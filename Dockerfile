# ── CryptoEdge Pro v2.0 — Dockerfile ──────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# System deps: curl (healthcheck) + python3 + build tools
RUN apk add --no-cache \
    curl \
    python3 \
    py3-pip \
    bash \
    && ln -sf python3 /usr/bin/python

# Install PM2 globally (process manager para o bot Python)
RUN npm install -g pm2 --no-audit --no-fund && pm2 --version

# Install Python bot dependencies
COPY bot/requirements.txt ./bot/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir \
    python-binance \
    python-dotenv \
    requests \
    websockets \
  || pip3 install --no-cache-dir \
    python-binance \
    python-dotenv \
    requests

# Install Node dependencies (production)
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Copy application source
COPY . .

# Data directory (sobrescrito pelo volume no EasyPanel)
RUN mkdir -p /data && chmod 777 /data

# Logs directory
RUN mkdir -p /app/logs && chmod 777 /app/logs

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=5 \
  CMD curl -sf http://localhost:3000/api/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "server.js"]
