import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, resolveTenantId } from "@/lib/authz";
import { pickSession } from "@/lib/outbound/enqueue";
import { launchCampaign, campaignStats } from "@/lib/outbound/campaign";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tenantId = await resolveTenantId(actor, new URL(req.url).searchParams.get("tenantId"));
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const campaigns = await db.campaign.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      mode: true,
      status: true,
      totalRecipients: true,
      scheduledAt: true,
      createdAt: true,
    },
  });
  const withStats = await Promise.all(
    campaigns.map(async (c) => ({ ...c, stats: await campaignStats(c.id) }))
  );
  return Response.json({ campaigns: withStats });
}

const createSchema = z
  .object({
    tenantId: z.string().optional(),
    name: z.string().min(1).max(120),
    mode: z.enum(["text", "template"]),
    body: z.string().max(4096).optional(),
    templateId: z.string().optional(),
    tags: z.array(z.string()).default([]),
    defaultVars: z.record(z.string()).optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    launchNow: z.boolean().default(true),
  })
  .refine((b) => b.mode !== "text" || (b.body && b.body.length > 0), { message: "body richiesto" })
  .refine((b) => b.mode !== "template" || !!b.templateId, { message: "templateId richiesto" });

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const tenantId = await resolveTenantId(actor, parsed.data.tenantId ?? null);
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const session = await pickSession(tenantId);
  if (!session) return Response.json({ error: "no whatsapp session" }, { status: 409 });

  const b = parsed.data;

  if (b.mode === "template") {
    const tpl = await db.template.findFirst({
      where: { id: b.templateId!, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!tpl) return Response.json({ error: "template non valido" }, { status: 400 });
  }
  // FIX D: idempotenza — nome campagna univoco per tenant (tra le non cancellate),
  // vincolato dall'indice unico parziale Campaign_tenantId_name_active. Un
  // doppio submit con lo stesso nome torna 409 invece di creare un duplicato.
  let campaign: { id: string };
  try {
    campaign = await db.campaign.create({
      data: {
        tenantId,
        sessionId: session.id,
        name: b.name,
        mode: b.mode === "template" ? "TEMPLATE" : "TEXT",
        body: b.body ?? null,
        templateId: b.templateId ?? null,
        defaultVars: { ...(b.defaultVars ?? {}), tags: b.tags },
        scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
        status: "DRAFT",
      },
      select: { id: true },
    });
  } catch (e) {
    // 409 SOLO su violazione di unicità (nome duplicato); altri errori → 500.
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return Response.json({ error: "nome campagna già esistente" }, { status: 409 });
    }
    throw e;
  }
  await auditLog({
    userId: actor.userId,
    tenantId,
    action: "campaign.create",
    entity: "Campaign",
    entityId: campaign.id,
    meta: { name: b.name, mode: b.mode },
  });

  if (b.launchNow) {
    // FIX E: la campagna è già stata creata (e committata) sopra: se il lancio
    // esplode NON dobbiamo propagare un 500, altrimenti l'utente ritenta il
    // POST e crea (o prova a creare, ora bloccato da FIX D) un duplicato.
    // La campagna resta DRAFT/RUNNING a seconda di dove è fallito launchCampaign
    // e può essere ri-lanciata (vedi FIX F) senza duplicare gli invii.
    try {
      const res = await launchCampaign(campaign.id);
      return Response.json({ id: campaign.id, ...res }, { status: 201 });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return Response.json({ id: campaign.id, enqueued: 0, launchError: message }, { status: 201 });
    }
  }
  return Response.json({ id: campaign.id, enqueued: 0 }, { status: 201 });
}
