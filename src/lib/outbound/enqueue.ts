/**
 * Inserimento job nella coda outbound. Risolve/crea il contatto destinatario
 * e la conversazione, sceglie la sessione del tenant, valida l'opt-in.
 * NON invia: il worker (Task 8) drena la coda.
 */
import { db } from "@/lib/db";
import type { OutboundPayload } from "./types";

/** Normalizza un numero in cifre senza prefisso "+"/suffissi. */
export function normalizePhone(input: string): string {
  return input.replace(/[^\d]/g, "");
}

/** Sessione CONNECTED del tenant (preferita) o la più recente. */
export async function pickSession(tenantId: string): Promise<{ id: string } | null> {
  const connected = await db.waSession.findFirst({
    where: { tenantId, deletedAt: null, status: "CONNECTED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (connected) return connected;
  return db.waSession.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

export interface ResolvedContact {
  id: string;
  optedIn: boolean;
}

/**
 * Trova o crea un Contact per il numero. `assertOptIn=true` (l'app integrante
 * dichiara il consenso) imposta optInStatus=IN. `optedIn` finale = IN oppure
 * almeno un messaggio IN in storico.
 */
export async function resolveSendableContact(
  tenantId: string,
  to: string,
  assertOptIn: boolean
): Promise<ResolvedContact> {
  const phone = normalizePhone(to);
  const waId = phone; // chiave di matching: cifre, senza suffisso

  let contact = await db.contact.findUnique({
    where: { tenantId_waId: { tenantId, waId } },
    select: { id: true, optInStatus: true },
  });

  if (!contact) {
    contact = await db.contact.create({
      data: {
        tenantId,
        waId,
        phone,
        optInStatus: assertOptIn ? "IN" : "UNKNOWN",
      },
      select: { id: true, optInStatus: true },
    });
  } else if (contact.optInStatus === "OUT") {
    // Opt-out esplicito: un integratore NON può ribaltarlo con optIn:true.
    return { id: contact.id, optedIn: false };
  } else if (assertOptIn && contact.optInStatus !== "IN") {
    contact = await db.contact.update({
      where: { id: contact.id },
      data: { optInStatus: "IN" },
      select: { id: true, optInStatus: true },
    });
  }

  let optedIn = contact.optInStatus === "IN";
  if (!optedIn) {
    const inbound = await db.message.count({
      where: { conversation: { contactId: contact.id }, direction: "IN" },
    });
    optedIn = inbound > 0;
  }
  return { id: contact.id, optedIn };
}

/** Conversazione aperta esistente per (contatto, sessione) o nuova. */
export async function ensureConversation(
  tenantId: string,
  contactId: string,
  sessionId: string
): Promise<string> {
  const existing = await db.conversation.findFirst({
    where: { tenantId, contactId, sessionId, deletedAt: null },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.conversation.create({
    data: { tenantId, contactId, sessionId, mode: "MANUAL", status: "OPEN" },
    select: { id: true },
  });
  return created.id;
}

export interface EnqueueParams {
  tenantId: string;
  sessionId: string;
  contactId: string;
  conversationId?: string;
  mode: "TEXT" | "TEMPLATE" | "INTENT";
  payload: OutboundPayload;
  source?: "API" | "CAMPAIGN";
  scheduledAt?: Date | null;
  campaignId?: string;
}

export async function enqueueOutbound(p: EnqueueParams): Promise<string> {
  const job = await db.outboundJob.create({
    data: {
      tenantId: p.tenantId,
      sessionId: p.sessionId,
      contactId: p.contactId,
      conversationId: p.conversationId ?? null,
      campaignId: p.campaignId ?? null,
      mode: p.mode,
      payload: p.payload as object,
      source: p.source ?? "API",
      scheduledAt: p.scheduledAt ?? null,
      status: "PENDING",
    },
    select: { id: true },
  });
  return job.id;
}
