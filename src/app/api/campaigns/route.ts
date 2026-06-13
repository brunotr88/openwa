import { z } from "zod";
import { db } from "@/lib/db";
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
    scheduledAt: z.string().datetime().optional(),
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
  const campaign = await db.campaign.create({
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

  if (b.launchNow) {
    const res = await launchCampaign(campaign.id);
    return Response.json({ id: campaign.id, ...res }, { status: 201 });
  }
  return Response.json({ id: campaign.id, enqueued: 0 }, { status: 201 });
}
