#!/bin/sh
# Container entrypoint (blueprint §5): apply migrations, seed, then start server.
set -e

echo "[start] Applying database migrations..."
npx prisma migrate deploy

echo "[start] Running idempotent seed..."
node scripts/seed-runner.js

echo "[start] Starting Next.js standalone server..."
exec node server.js
