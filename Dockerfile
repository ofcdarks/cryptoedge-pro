# ============================================================
# LaCasaStudio V2.3 — TypeScript + PostgreSQL Production Build
# ============================================================

FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json client/tsconfig*.json client/tailwind.config.js client/postcss.config.js ./
RUN npm install
COPY client/ ./
RUN npx tsc --noEmit && npx vite build

FROM node:20-slim AS server-build
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json server/tsconfig.json ./
COPY server/prisma ./prisma/
RUN npm install && npx prisma generate
COPY server/src ./src/
RUN npx tsc --skipLibCheck 2>&1 || true

FROM node:20-slim AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
COPY server/prisma ./prisma/
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install --omit=dev && npx prisma generate

FROM node:20-slim AS production
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl wget && rm -rf /var/lib/apt/lists/*
RUN groupadd -r appgroup && useradd -r -g appgroup -m appuser

COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/dist ./server/dist
COPY server/prisma ./server/prisma/
COPY --from=client-build /app/client/dist ./server/public

RUN mkdir -p /app/server/uploads && chown -R appuser:appgroup /app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["sh", "-c", "cd server && npx prisma migrate deploy 2>/dev/null || npx prisma db push 2>/dev/null; node dist/db/seed.js 2>/dev/null; node dist/index.js"]
