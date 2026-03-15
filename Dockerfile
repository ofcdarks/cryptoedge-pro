# ── CryptoEdge Pro — Dockerfile (EasyPanel optimized) ──────────────────────────
FROM node:20-alpine

WORKDIR /app

# Only curl for healthcheck
RUN apk add --no-cache curl

# Install dependencies
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Copy application files
COPY . .

# Create data directory
RUN mkdir -p /data

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
