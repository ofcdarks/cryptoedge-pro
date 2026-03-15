# ── CryptoEdge Pro — Dockerfile para EasyPanel ─────────────────────────────────
# Stage 1: Build dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Production image
FROM node:20-alpine AS runner
WORKDIR /app

# Install Python (opcional — para o bot de trading)
# Remova as linhas abaixo se não for usar o bot Python
RUN apk add --no-cache python3 py3-pip curl && \
    pip3 install --break-system-packages --no-cache-dir \
    python-binance python-dotenv requests && \
    rm -rf /root/.cache/pip

# Copy Node app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create persistent data directory
RUN mkdir -p /data && \
    chown -R node:node /data /app

# Run as non-root user (security best practice)
USER node

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data

EXPOSE 3000

# Health check for EasyPanel
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
