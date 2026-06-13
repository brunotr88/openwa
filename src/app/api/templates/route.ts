import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, resolveTenantId } from "@/lib/authz";
import { extractVariables } from "@/lib/outbound/template";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tenantId = await resolveTenantId(actor, new URL(req.url).searchParams.get("tenantId"));
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const templates = await db.template.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, body: true, variables: true, updatedAt: true },
  });
  return Response.json({ templates });
}

const upsertSchema = z.object({
  tenantId: z.string().optional(),
  name: z.string().min(1).max(80),
  body: z.string().min(1).max(4096),
});

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  const tenantId = await resolveTenantId(actor, parsed.data.tenantId ?? null);
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const variables = extractVariables(parsed.data.body);
  try {
    const tpl = await db.template.create({
      data: { tenantId, name: parsed.data.name, body: parsed.data.body, variables },
      select: { id: true, name: true, body: true, variables: true, updatedAt: true },
    });
    await auditLog({
      userId: actor.userId,
      tenantId,
      action: "template.create",
      entity: "Template",
      entityId: tpl.id,
      meta: { name: tpl.name },
    });
    return Response.json({ template: tpl }, { status: 201 });
  } catch {
    return Response.json({ error: "nome già esistente" }, { status: 409 });
  }
}
