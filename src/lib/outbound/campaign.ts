/**
 * Lancio campagna: enumera i destinatari eleggibili (opt-in IN o con storico
 * IN, filtrabili per tag) e crea un OutboundJob per ciascuno con campaignId.
 * Il pacing/anti-ban è gestito dal worker (al più 1 invio/sessione/tick), così
 * una campagna di N contatti viene spalmata nel tempo in modo sicuro.
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { enqueueOutbound, ensureConversation } from "./enqueue";
import type { OutboundPayload } from "./types";

export interface LaunchResult {
  enqueued: number;
  skipped: number;
}

/** Rimuove la chiave `tags` (dato di eligibilità) dalle var di template. */
function stripTags(vars: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (k === "tags") continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Contatti del tenant eleggibili all'invio (opt-in o con almeno un IN). */
async function eligibleContacts(tenantId: string, tags: string[]): Promise<{ id: string; name: string | null }[]> {
  const contacts = await db.contact.findMany({
    where: {
      tenantId,
      deletedAt: null,
      optInStatus: { not: "OUT" }, // opt-out esplicito: mai incluso in campagna
      ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
    },
    select: { id: true, name: true, optInStatus: true },
  });
  const result: { id: string; name: string | null }[] = [];
  for (const c of contacts) {
    if (c.optInStatus === "IN") {
      result.push({ id: c.id, name: c.name });
      continue;
    }
    const inbound = await db.message.count({
      where: { conversation: { contactId: c.id }, direction: "IN" },
    });
    if (inbound > 0) result.push({ id: c.id, name: c.name });
  }
  return result;
}

export async function launchCampaign(campaignId: string): Promise<LaunchResult> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("campaign not found");

  // C5: CLAIM atomico — una campagna viene lanciata una sola volta anche con
  // doppio click / retry. Solo chi passa DRAFT→RUNNING procede a mettere in coda.
  const claimed = await db.campaign.updateMany({
    where: { id: campaignId, status: "DRAFT" },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) throw new Error("campaign not in DRAFT");

  const tags = Array.isArray((campaign.defaultVars as { tags?: string[] } | null)?.tags)
    ? ((campaign.defaultVars as { tags?: string[] }).tags as string[])
    : [];
  const recipients = await eligibleContacts(campaign.tenantId, tags);

  let enqueued = 0;
  for (const c of recipients) {
    const conversationId = await ensureConversation(campaign.tenantId, c.id, campaign.sessionId);
    const payload: OutboundPayload =
      campaign.mode === "TEMPLATE" && campaign.templateId
        ? {
            mode: "TEMPLATE",
            templateId: campaign.templateId,
            // C8: `tags` è un dato di eligibilità, non una var renderizzabile;
            // e il nome per-contatto deve vincere su un eventuale defaultVars.nome.
            vars: { ...stripTags((campaign.defaultVars as Record<string, unknown>) ?? {}), nome: c.name ?? "" },
          }
        : { mode: "TEXT", text: campaign.body ?? "" };

    await enqueueOutbound({
      tenantId: campaign.tenantId,
      sessionId: campaign.sessionId,
      contactId: c.id,
      conversationId,
      mode: campaign.mode === "TEMPLATE" ? "TEMPLATE" : "TEXT",
      payload,
      source: "CAMPAIGN",
      campaignId: campaign.id,
      scheduledAt: campaign.scheduledAt ?? null,
    });
    enqueued++;
  }

  // Lo status è già RUNNING dal claim atomico; qui aggiorniamo solo il conteggio.
  await db.campaign.update({
    where: { id: campaign.id },
    data: { totalRecipients: enqueued },
  });
  await auditLog({
    tenantId: campaign.tenantId,
    action: "campaign.launch",
    entity: "Campaign",
    entityId: campaign.id,
    meta: { enqueued, tags },
  });
  return { enqueued, skipped: 0 };
}

export interface CampaignStats {
  total: number;
  pending: number;
  sent: number;
  failed: number;
}

export async function campaignStats(campaignId: string): Promise<CampaignStats> {
  const groups = await db.outboundJob.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const get = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const sent = get("DONE");
  const failed = get("FAILED") + get("CANCELED");
  const pending = get("PENDING") + get("SENDING");
  return { total: sent + failed + pending, pending, sent, failed };
}
