/**
 * Riconciliazione stato sessione WA col gateway.
 *
 * Il GET /api/sessions serve WaSession.status dal DB. Se il webhook
 * session.disconnected va perso, lo stato resta CONNECTED per sempre e
 * non c'è alcun percorso UI/cron che lo corregga (l'unico altro punto che
 * interroga il gateway è /api/sessions/[id]/qr, raggiungibile solo quando
 * lo stato non è già CONNECTED). Qui ricontrolliamo col gateway le
 * sessioni CONNECTED senza heartbeat recente prima di servirle.
 */
import { db } from "@/lib/db";
import { getSession } from "@/lib/wa/gateway-client";
import type { WaSessionStatus } from "@prisma/client";

// Se una sessione risulta CONNECTED nel DB ma non riceve un heartbeat
// (messaggio o webhook di stato) entro questa finestra, riconciliamo col
// gateway prima di servire la lista, invece di fidarci ciecamente del DB.
export const STALE_CONNECTED_MS = 10 * 60 * 1000;

/** Stessa mappatura usata dal webhook handler (src/app/api/webhooks/wa/route.ts). */
export function mapGatewayStatus(status: string): WaSessionStatus | null {
  switch (status) {
    case "ready":
    case "connected":
      return "CONNECTED";
    case "qr_ready":
    case "qr":
      return "QR";
    case "disconnected":
    case "logged_out":
    case "failed":
      return "OFFLINE";
    default:
      return null;
  }
}

export interface ReconcilableSession {
  id: string;
  status: WaSessionStatus;
  lastSeenAt: Date | null;
  sessionDataRef?: string | null;
}

/**
 * Ricontrolla col gateway le sessioni segnate CONNECTED ma senza heartbeat
 * recente, per non restare bloccati su uno stato stale se un webhook
 * session.disconnected è andato perso. Best-effort: un errore gateway
 * lascia lo stato DB invariato (si riproverà al prossimo GET).
 */
export async function reconcileStaleConnected<T extends ReconcilableSession>(
  sessions: T[]
): Promise<T[]> {
  const now = Date.now();
  const stale = sessions.filter(
    (s) =>
      s.status === "CONNECTED" &&
      s.sessionDataRef &&
      (!s.lastSeenAt || now - s.lastSeenAt.getTime() > STALE_CONNECTED_MS)
  );
  if (stale.length === 0) return sessions;

  const updates = new Map<string, WaSessionStatus>();
  await Promise.all(
    stale.map(async (s) => {
      try {
        const gw = await getSession(s.sessionDataRef as string);
        const mapped = mapGatewayStatus(gw.status);
        if (mapped && mapped !== s.status) {
          updates.set(s.id, mapped);
          await db.waSession.update({
            where: { id: s.id },
            data: { status: mapped, lastSeenAt: new Date() },
          });
        }
      } catch {
        // gateway unreachable → mantieni lo stato DB.
      }
    })
  );
  if (updates.size === 0) return sessions;
  return sessions.map((s) =>
    updates.has(s.id) ? { ...s, status: updates.get(s.id) as WaSessionStatus } : s
  );
}
