# ── CryptoEdge Pro v2.0 — Dockerfile (EasyPanel / Docker) ─────────────────────
FROM node:20-alpine

WORKDIR /app

# Install curl (healthcheck) + python3 + pip (bot)
RUN apk add --no-cache curl python3 py3-pip

# Install Python bot dependencies
COPY bot/requirements.txt ./bot/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir \
    python-binance python-dotenv requests 2>/dev/null || \
    pip3 install --no-cache-dir \
    python-binance python-dotenv requests

# Install Node dependencies (production only)
COPY package*.json ./
RUN npm ci --only=production --no-audit --no-fund && npm cache clean --force

# Copy application source
COPY . .

# Create persistent data directory
RUN mkdir -p /data && chmod 777 /data

# Non-root user for security
RUN addgroup -S cryptoedge && adduser -S cryptoedge -G cryptoedge
RUN chown -R cryptoedge:cryptoedge /app /data
USER cryptoedge

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
  CMD curl -sf http://localhost:3000/api/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "server.js"]
