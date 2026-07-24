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

  const notIn = contacts.filter((c) => c.optInStatus !== "IN");
  // FIX G: prima era 1 query `message.count` per contatto non-IN (N+1). Un solo
  // giro: prendiamo i contactId con almeno un Message IN tra i candidati e
  // filtriamo in memoria — stessa logica di eleggibilità, una query sola.
  const hasInboundIds = new Set<string>();
  if (notIn.length > 0) {
    const withInbound = await db.message.findMany({
      where: {
        direction: "IN",
        conversation: { contactId: { in: notIn.map((c) => c.id) } },
      },
      select: { conversation: { select: { contactId: true } } },
    });
    for (const m of withInbound) hasInboundIds.add(m.conversation.contactId);
  }

  const result: { id: string; name: string | null }[] = [];
  for (const c of contacts) {
    if (c.optInStatus === "IN" || hasInboundIds.has(c.id)) {
      result.push({ id: c.id, name: c.name });
    }
  }
  return result;
}

export async function launchCampaign(campaignId: string): Promise<LaunchResult> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("campaign not found");

  // C5/FIX F: CLAIM atomico DRAFT→RUNNING per il primo lancio. Un ri-lancio
  // (retry dopo un enqueue parziale fallito, o un tick del worker che non
  // aveva ancora marcato COMPLETED) è ammesso anche a partire da RUNNING:
  // l'enqueue sotto è reso idempotente (P2002 su campaignId+contactId → skip),
  // quindi ri-lanciare una campagna RUNNING completa solo i contatti mancanti
  // senza duplicare gli invii già accodati.
  const claimed = await db.campaign.updateMany({
    where: { id: campaignId, status: { in: ["DRAFT", "RUNNING"] } },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) throw new Error("campaign not launchable (status terminale)");

  const tags = Array.isArray((campaign.defaultVars as { tags?: string[] } | null)?.tags)
    ? ((campaign.defaultVars as { tags?: string[] }).tags as string[])
    : [];
  const recipients = await eligibleContacts(campaign.tenantId, tags);

  let enqueued = 0;
  let skipped = 0;
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

    try {
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
    } catch (e) {
      // FIX F: P2002 sull'unique (campaignId, contactId) = contatto già
      // accodato da un lancio precedente → non è un errore, si salta.
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
        skipped++;
        continue;
      }
      throw e;
    }
  }

  // Lo status è già RUNNING dal claim atomico; qui aggiorniamo solo il conteggio
  // (su un ri-lancio, riflette il totale eleggibili corrente, non solo i nuovi).
  await db.campaign.update({
    where: { id: campaign.id },
    data: { totalRecipients: enqueued + skipped },
  });
  await auditLog({
    tenantId: campaign.tenantId,
    action: "campaign.launch",
    entity: "Campaign",
    entityId: campaign.id,
    meta: { enqueued, skipped, tags },
  });
  return { enqueued, skipped };
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
  const total = sent + failed + pending;

  // FIX H: aggiornamento pigro — campaignStats è chiamata sia dalla lista sia
  // dal dettaglio campagne, quindi è il punto più semplice per accorgersi che
  // tutti i job sono in stato terminale e chiudere la campagna. `updateMany`
  // con `where: { status: "RUNNING" }` è idempotente (no-op se già DONE/altro)
  // e non richiede una query extra per leggere lo stato corrente.
  if (total > 0 && pending === 0) {
    await db.campaign.updateMany({
      where: { id: campaignId, status: "RUNNING" },
      data: { status: "DONE" },
    });
  }

  return { total, pending, sent, failed };
}
