# ── CryptoEdge Pro — Dockerfile ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# curl for healthcheck
RUN apk add --no-cache curl

# Install dependencies
COPY package*.json ./
RUN npm install --production --no-audit && npm cache clean --force

# Copy application
COPY . .

# Create data directory with proper permissions
RUN mkdir -p /data && chmod 777 /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
