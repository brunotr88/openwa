#!/bin/sh
# Container entrypoint (blueprint §5): apply migrations, seed, then start server.
set -e

# Si invoca il binario di Prisma direttamente invece che con `npx`, cosi' npm
# non serve a runtime e resta fuori dall'immagine.
echo "[start] Applying database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "[start] Running idempotent seed..."
node scripts/seed-runner.js

echo "[start] Starting Next.js standalone server..."
exec node server.js
