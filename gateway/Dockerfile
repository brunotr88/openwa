# syntax=docker/dockerfile:1
# OpenWA gateway — Node + Chromium worker for @open-wa/wa-automate.
#
# BUILD CONTEXT: the repository ROOT (not gateway/), because the gateway reuses
# the shared Prisma schema at prisma/schema.prisma. In Coolify set:
#   Dockerfile location = gateway/Dockerfile
#   Base directory      = /            (repo root as build context)
#
# Alpine is intentionally NOT used: open-wa/puppeteer needs glibc + a real
# Chromium. node:22-bookworm-slim gives us Debian glibc; we install the distro
# chromium and tell puppeteer to use it (no bundled-Chromium download).

FROM node:22-bookworm-slim AS base
WORKDIR /app

# Chromium + the runtime libs open-wa/puppeteer needs, plus fonts so QR/media
# render, and openssl for Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 libcairo2 \
      libgtk-3-0 \
      openssl \
      wget curl \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer: never download its own Chromium; use the system one.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

# ── Build stage ───────────────────────────────────────────────────────────────
FROM base AS builder
ENV NODE_ENV=development

# Install gateway deps (includes dev deps for tsc / prisma).
COPY gateway/package.json gateway/package-lock.json* ./gateway/
WORKDIR /app/gateway
RUN npm install

# Generate the Prisma client into gateway/node_modules. `prisma generate`
# resolves its output by walking up from the schema dir, so we sync the shared
# root schema into ./prisma (inside the gateway) and generate from there — same
# approach as the local prisma:generate script. This keeps the generated client
# in /app/gateway/node_modules, not /app/node_modules.
COPY prisma /app/prisma
RUN mkdir -p ./prisma \
    && cp /app/prisma/schema.prisma ./prisma/schema.prisma \
    && npx prisma generate --schema ./prisma/schema.prisma

# Compile TypeScript.
COPY gateway/tsconfig.json ./
COPY gateway/src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app/gateway

ENV SESSIONS_DIR=/app/sessions \
    PORT=8080

# Generated client + deps + compiled output + schema (for any runtime prisma use).
COPY --from=builder /app/gateway/node_modules ./node_modules
COPY --from=builder /app/gateway/dist ./dist
COPY --from=builder /app/gateway/package.json ./package.json
COPY --from=builder /app/prisma /app/prisma

# Session token volume (persisted by Coolify).
RUN mkdir -p /app/sessions

EXPOSE 8080

CMD ["node", "dist/index.js"]
