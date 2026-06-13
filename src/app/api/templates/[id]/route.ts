import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { extractVariables } from "@/lib/outbound/template";

export const dynamic = "force-dynamic";

const putSchema = z.object({ name: z.string().min(1).max(80), body: z.string().min(1).max(4096) });

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const tpl = await db.template.findUnique({ where: { id }, select: { tenantId: true } });
  if (!tpl || !canAccessTenant(actor, tpl.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  const updated = await db.template.update({
    where: { id },
    data: {
      name: parsed.data.name,
      body: parsed.data.body,
      variables: extractVariables(parsed.data.body),
    },
    select: { id: true, name: true, body: true, variables: true, updatedAt: true },
  });
  await auditLog({
    userId: actor.userId,
    tenantId: tpl.tenantId,
    action: "template.update",
    entity: "Template",
    entityId: id,
  });
  return Response.json({ template: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const tpl = await db.template.findUnique({ where: { id }, select: { tenantId: true } });
  if (!tpl || !canAccessTenant(actor, tpl.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await db.template.update({ where: { id }, data: { deletedAt: new Date() } });
  await auditLog({
    userId: actor.userId,
    tenantId: tpl.tenantId,
    action: "template.delete",
    entity: "Template",
    entityId: id,
  });
  return Response.json({ ok: true });
}
