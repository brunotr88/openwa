# syntax=docker/dockerfile:1
# OpenWA gateway — Node worker for the Baileys (WhatsApp Web WebSocket) engine.
#
# BUILD CONTEXT: the repository ROOT (not gateway/), because the gateway reuses
# the shared Prisma schema at prisma/schema.prisma. In Coolify set:
#   Dockerfile location = gateway/Dockerfile
#   Base directory      = /            (repo root as build context)
#
# Baileys needs NO Chromium/puppeteer/X11/fonts — it speaks the multi-device
# protocol directly over a WebSocket. We only need openssl + ca-certificates
# (Prisma engine / TLS) and wget (container healthcheck). The image is therefore
# dramatically smaller than the old open-wa one.

FROM node:22-bookworm-slim AS base
WORKDIR /app

# Minimal runtime deps: openssl + ca-certificates for Prisma/TLS, wget for the
# container healthcheck. No chromium, no fonts, no X11 libs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl \
      ca-certificates \
      wget \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

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

# Session creds volume (persisted by Coolify): Baileys multi-file auth state.
RUN mkdir -p /app/sessions

EXPOSE 8080

CMD ["node", "dist/index.js"]
