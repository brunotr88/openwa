/**
 * Worker tick — invocato dal cron Coolify ogni minuto.
 * Auth: Authorization: Bearer <INTERNAL_GATEWAY_SECRET>, confronto
 * timingSafeEqual. Drena la coda (al più 1 job/sessione) e ritorna il riepilogo.
 */
import { timingSafeEqual } from "crypto";
import { drainOutbound } from "@/lib/outbound/worker";
import { autoCloseInactiveConversations } from "@/lib/inbox/auto-close";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.INTERNAL_GATEWAY_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const summary = await drainOutbound(now);
  const autoClose = await autoCloseInactiveConversations(now);
  return Response.json({ ok: true, ...summary, autoClose });
}
