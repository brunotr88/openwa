#!/usr/bin/env bash
# Cron worker outbound — esegue un tick della coda ogni minuto.
# Installazione (sul server, come per wa-keepalive):
#   * * * * * INTERNAL_GATEWAY_SECRET=<secret> /usr/local/bin/outbound-tick.sh
# In Coolify: Scheduled Task, comando:
#   curl -fsS -X POST http://openwa-web:3000/api/internal/outbound/tick \
#        -H "Authorization: Bearer $INTERNAL_GATEWAY_SECRET"  (frequenza: * * * * *)
set -euo pipefail
URL="${OUTBOUND_TICK_URL:-http://openwa-web:3000/api/internal/outbound/tick}"
curl -fsS -m 50 -X POST "$URL" \
  -H "Authorization: Bearer ${INTERNAL_GATEWAY_SECRET:?manca INTERNAL_GATEWAY_SECRET}" \
  >/dev/null
