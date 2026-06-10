/**
 * Single session API.
 * GET    → session detail (tenant-checked)
 * DELETE → delete on gateway + soft-delete WaSession
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { deleteSession } from "@/lib/wa/gateway-client";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.waSession.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      tenantId: true,
      phoneLabel: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });
  if (!session || !canAccessTenant(actor, session.tenantId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ session });
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.waSession.findFirst({
    where: { id, deletedAt: null },
  });
  if (!session || !canAccessTenant(actor, session.tenantId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  if (session.sessionDataRef) {
    try {
      await deleteSession(session.sessionDataRef);
    } catch (e) {
      // Gateway session may already be gone — log and continue with soft delete.
      console.error("[sessions] gateway delete failed:", e);
    }
  }

  await db.waSession.update({
    where: { id: session.id },
    data: { deletedAt: new Date(), status: "OFFLINE" },
  });

  await auditLog({
    userId: actor.userId,
    tenantId: session.tenantId,
    action: "wa.session.delete",
    entity: "WaSession",
    entityId: session.id,
  });

  return Response.json({ ok: true });
}
