/**
 * Settings API per-numero (M5).
 * GET  ?sessionId= → { tenantId, sessionId, settings, numbers, sentToday }
 *      (sessione richiesta validata sul tenant, altrimenti primaria).
 * PUT  { sessionId, settings: <patch> } → deep-merge + zod-validate + persist
 *      sul numero + audit log.
 */
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, resolveTenantId, canAccessTenant } from "@/lib/authz";
import { getSessionSettings, saveSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const requested = new URL(req.url).searchParams.get("tenantId");
  const tenantId = await resolveTenantId(actor, requested);
  if (!tenantId) {
    return Response.json({ error: "no tenant available" }, { status: requested ? 403 : 400 });
  }

  const requestedSession = new URL(req.url).searchParams.get("sessionId");
  const sessions = await db.waSession.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, status: true, createdAt: true, phoneLabel: true },
    orderBy: { createdAt: "desc" },
  });
  const sessionId =
    (requestedSession && sessions.some((s) => s.id === requestedSession) && requestedSession) ||
    pickPrimarySession(sessions);
  if (!sessionId) {
    return Response.json({ tenantId, sessionId: null, settings: null, numbers: sessions, sentToday: 0 });
  }
  const settings = await getSessionSettings(sessionId);

  // Trasparenza sui limiti: "Oggi: X/cap messaggi inviati" — per numero.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await db.message.count({
    where: {
      conversation: { sessionId },
      direction: "OUT",
      status: { in: ["SENT", "DELIVERED", "READ"] },
      createdAt: { gte: startOfDay },
    },
  });

  return Response.json({ tenantId, sessionId, settings, numbers: sessions, sentToday });
}

export async function PUT(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { sessionId?: string; settings?: unknown } | null;
  if (!body || typeof body !== "object" || !body.sessionId || !body.settings || typeof body.settings !== "object") {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const session = await db.waSession.findFirst({
    where: { id: body.sessionId, deletedAt: null },
    select: { id: true, tenantId: true },
  });
  if (!session || !canAccessTenant(actor, session.tenantId)) {
    return Response.json({ error: "numero non valido" }, { status: 400 });
  }
  let settings;
  try {
    settings = await saveSessionSettings(session.id, body.settings);
  } catch (e) {
    if (e instanceof ZodError) {
      return Response.json({ error: "invalid settings", issues: e.issues }, { status: 400 });
    }
    throw e;
  }
  await auditLog({
    userId: actor.userId, tenantId: session.tenantId,
    action: "wa.settings.update", entity: "WaSession", entityId: session.id,
    meta: {},
  });
  return Response.json({ sessionId: session.id, settings });
}
