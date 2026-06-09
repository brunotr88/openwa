# syntax=docker/dockerfile:1
# Multi-stage Next.js standalone build (blueprint §5).

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install all deps (Prisma needs OpenSSL at generate time).
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci

# Generate Prisma client, then build the standalone output.
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# wget/curl for Coolify healthcheck; openssl for Prisma at runtime.
RUN apk add --no-cache wget curl openssl

# Standalone server + static assets + public dir.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma schema/migrations + seed runner + entrypoint.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

# Full node_modules copy — selective copy breaks Prisma transitive deps (blueprint §5).
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["sh", "scripts/start.sh"]
