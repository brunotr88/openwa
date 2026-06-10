/**
 * Stop a session on the gateway (keeps auth data; can be restarted).
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { stopSession } from "@/lib/wa/gateway-client";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.waSession.findFirst({
    where: { id, deletedAt: null },
  });
  if (!session || !canAccessTenant(actor, session.tenantId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (!session.sessionDataRef) {
    return Response.json({ error: "session not linked to gateway" }, { status: 409 });
  }

  try {
    await stopSession(session.sessionDataRef);
  } catch (e) {
    console.error("[sessions/stop] gateway error:", e);
    return Response.json({ error: "gateway error" }, { status: 502 });
  }

  await db.waSession.update({
    where: { id: session.id },
    data: { status: "OFFLINE", lastSeenAt: new Date() },
  });

  await auditLog({
    userId: actor.userId,
    tenantId: session.tenantId,
    action: "wa.session.stop",
    entity: "WaSession",
    entityId: session.id,
  });

  return Response.json({ ok: true });
}
