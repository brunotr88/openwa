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

# Le dipendenze di sviluppo non devono finire in produzione: il runner riceve
# l'intero node_modules del builder, e `npm ci` installa anche le devDependencies.
# Arrivavano cosi' nell'immagine finale vitest, vite, typescript, postcss,
# autoprefixer, tailwindcss e i @types — fra cui una vulnerabilita' CRITICAL su
# vitest, su codice che in produzione non viene mai eseguito.
#
# Il prune va DOPO il build, che della toolchain ha bisogno. Verificato modulo
# per modulo che gli script lanciati da scripts/start.sh usano solo
# @prisma/client e bcryptjs, entrambe dependencies.
RUN npm prune --omit=dev

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
# Dallo stage builder arriva ora l'albero gia' ripulito dalle devDependencies.
COPY --from=builder /app/node_modules ./node_modules

# npm non serve a far girare l'applicazione: start.sh invoca il binario di Prisma
# direttamente e il server parte con `node server.js`. Le dipendenze interne di
# npm portano vulnerabilita' su codice mai eseguito.
# wget e curl restano: Coolify, per i build da Dockerfile, ignora l'HEALTHCHECK
# dichiarato e ne inietta uno proprio che li invoca.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx

# Il container girava come root: non c'era alcuna direttiva USER. Non ci sono
# volumi montati, quindi non ci sono file di proprieta' di root da preservare.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

CMD ["sh", "scripts/start.sh"]
