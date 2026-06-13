/**
 * Revoca (soft-delete) di una singola API key, tenant-scoped.
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const key = await db.apiKey.findUnique({ where: { id }, select: { id: true, tenantId: true } });
  if (!key || !canAccessTenant(actor, key.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await db.apiKey.update({ where: { id }, data: { deletedAt: new Date() } });
  await auditLog({
    userId: actor.userId,
    tenantId: key.tenantId,
    action: "apikey.revoke",
    entity: "ApiKey",
    entityId: id,
  });
  return Response.json({ ok: true });
}
