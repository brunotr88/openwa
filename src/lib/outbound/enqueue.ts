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

/**
 * Conversazione OPEN esistente per (contatto, sessione), o nuova OPEN.
 * FIX 3: allineato al webhook, che riusa/crea solo conversazioni OPEN — un
 * findFirst senza filtro status riaprirebbe/riuserebbe anche CLOSED/SNOOZED,
 * scaricando messaggi outbound in conversazioni che l'operatore ha chiuso.
 * Scelta più semplice: cerchiamo solo tra le OPEN; se non c'è, ne creiamo una
 * nuova (non riapriamo una CLOSED/SNOOZED esistente, per non "resuscitare"
 * silenziosamente una conversazione che un operatore ha volutamente chiuso).
 */
export async function ensureConversation(
  tenantId: string,
  contactId: string,
  sessionId: string
): Promise<string> {
  const existing = await db.conversation.findFirst({
    where: { tenantId, contactId, sessionId, status: "OPEN", deletedAt: null },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  try {
    const created = await db.conversation.create({
      data: { tenantId, contactId, sessionId, mode: "MANUAL", status: "OPEN" },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    // P2002 = indice unico parziale Conversation_open_uniq: un'altra delivery
    // concorrente (webhook o altro enqueue) ha già creato la OPEN → riusala.
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      const found = await db.conversation.findFirst({
        where: { tenantId, contactId, sessionId, status: "OPEN", deletedAt: null },
        select: { id: true },
      });
      if (found) return found.id;
    }
    throw e;
  }
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
