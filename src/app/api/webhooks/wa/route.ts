/**
 * Gateway webhook receiver (public route — listed in auth.config.ts).
 *
 * Signature (verified in fork source, webhook.service.ts):
 *   header  X-OpenWA-Signature: "sha256=<hex>"
 *   value   HMAC-SHA256(raw JSON body, webhook secret)
 * Payload envelope:
 *   { event, timestamp, sessionId, idempotencyKey, deliveryId, data }
 *
 * Events handled:
 * - message.received → JID/type filtering (whatsapp-ops.md), upsert Contact,
 *   find/create OPEN Conversation, Message(IN, RECEIVED, WA), then
 *   fire-and-forget reply pipeline
 * - message.ack → matches Message.waMessageId (OUT), maps ack≥2→DELIVERED,
 *   ack≥3→READ (whatsapp-web.js ACK semantics)
 * - session.status / session.authenticated / session.disconnected →
 *   map gateway status onto WaSession.status
 *
 * Inbox filtering (whatsapp-ops.md):
 * - status@broadcast, *@newsletter, *@broadcast → IGNORA
 * - reazioni, protocol/e2e_notification/notification_template/gp2/call/
 *   ciphertext → IGNORA
 * - *@g.us (gruppi) → memorizza ma MAI auto-reply (salvo settings
 *   sending.groupAutoReply); inbox.filterGroups "ignora" → scarta
 * - *@lid → contatto normale, waId senza suffisso
 * - fromMe → IGNORA (loop!)
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { generateAndDeliverReply } from "@/lib/wa/reply";
import { shouldIgnoreInbound, normalizeWaId } from "@/lib/wa/inbound-filter";
import { getContact, mapGatewayStatus } from "@/lib/wa/gateway-client";
import { mapGatewayContact, resolutionPatch } from "@/lib/wa/contact-resolve";
import { getSessionSettings } from "@/lib/settings/session";

export const dynamic = "force-dynamic";

/**
 * Finestra di validità del timestamp del webhook (anti-replay). Generosa:
 * copre il clock skew fra gateway e app e gli eventuali retry del gateway.
 */
const WEBHOOK_MAX_SKEW_MS = 5 * 60_000;

const SIGNATURE_HEADER = "x-openwa-signature";

interface WebhookEnvelope {
  event: string;
  timestamp: string;
  sessionId: string; // gateway session UUID
  idempotencyKey?: string;
  deliveryId?: string;
  data: Record<string, unknown>;
}

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WA_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook/wa] WA_WEBHOOK_SECRET not configured");
    return false;
  }
  if (!header) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handleMessageReceived(envelope: WebhookEnvelope): Promise<void> {
  const data = envelope.data ?? {};

  const session = await db.waSession.findFirst({
    where: { sessionDataRef: envelope.sessionId, deletedAt: null },
  });
  if (!session) {
    console.warn(`[webhook/wa] no WaSession for gateway session ${envelope.sessionId}`);
    return;
  }

  const settings = await getSessionSettings(session.id);
  if (shouldIgnoreInbound(data, settings)) return;

  // Original chat id WITH its suffix (@lid / @c.us / @s.whatsapp.net) — needed
  // to resolve the real name/number via the gateway. waId is the stable,
  // suffix-stripped matching key (unchanged, so message matching still works).
  const chatId = typeof data.chatId === "string" ? data.chatId : String(data.from ?? "");
  const rawBody = typeof data.body === "string" ? data.body : "";
  // Media senza caption (rawBody="") viene comunque tracciato in history con
  // un placeholder — altrimenti viene escluso dalla history (filtro body vuoti
  // in reply.ts) e il modello perde il turno del cliente.
  const msgType = typeof data.type === "string" ? data.type : "";
  const isMediaType = ["image", "video", "audio", "ptt", "document", "sticker"].includes(
    msgType
  );
  const body = !rawBody && isMediaType ? "[media]" : rawBody;
  const isGroup = data.isGroup === true || chatId.endsWith("@g.us");

  const waId = normalizeWaId(chatId);
  const pushName =
    typeof data.pushName === "string" && data.pushName ? data.pushName : undefined;

  const contact = await db.contact.upsert({
    where: { tenantId_waId: { tenantId: session.tenantId, waId } },
    create: {
      tenantId: session.tenantId,
      waId,
      name: pushName ?? null,
    },
    update: pushName ? { name: pushName } : {},
  });

  // Resolve the REAL name + phone behind the @lid privacy id. One extra gateway
  // call, guarded so the webhook always responds fast and never fails on it.
  // Skip for groups (no per-contact resolution) and when not connected.
  if (!isGroup && session.sessionDataRef) {
    try {
      const resolved = mapGatewayContact(
        await getContact(session.sessionDataRef, chatId)
      );
      const patch = resolutionPatch(resolved, {
        name: contact.name,
        phone: contact.phone,
      });
      if (Object.keys(patch).length > 0) {
        await db.contact.update({ where: { id: contact.id }, data: patch });
      }
    } catch (e) {
      console.error("[webhook/wa] contact resolution failed:", e);
    }
  }

  // Tenant default mode from TenantSettings.behavior.aiMode.
  // Gruppi: MAI auto-reply (default) — solo se sending.groupAutoReply è ON.
  const tenantMode =
    settings.behavior.aiMode === "AUTO"
      ? "AUTO"
      : settings.behavior.aiMode === "COPILOT"
        ? "COPILOT"
        : "MANUAL";
  const defaultMode =
    isGroup && !settings.sending.groupAutoReply ? "MANUAL" : tenantMode;

  let conversation = await db.conversation.findFirst({
    where: {
      tenantId: session.tenantId,
      contactId: contact.id,
      sessionId: session.id,
      status: "OPEN",
      deletedAt: null,
    },
  });
  if (!conversation) {
    try {
      conversation = await db.conversation.create({
        data: {
          tenantId: session.tenantId,
          contactId: contact.id,
          sessionId: session.id,
          mode: defaultMode,
          status: "OPEN",
        },
      });
    } catch (e) {
      // P2002 = violazione dell'indice unico parziale Conversation_open_uniq:
      // un'altra delivery concorrente ha già creato la OPEN → riusala.
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
        conversation = await db.conversation.findFirst({
          where: {
            tenantId: session.tenantId,
            contactId: contact.id,
            sessionId: session.id,
            status: "OPEN",
            deletedAt: null,
          },
        });
        if (!conversation) throw e;
      } else {
        throw e;
      }
    }
  }

  await db.message.create({
    data: {
      conversationId: conversation.id,
      tenantId: session.tenantId,
      direction: "IN",
      body,
      status: "RECEIVED",
      aiGenerated: false,
      source: "WA",
    },
  });

  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  // Un messaggio in arrivo è prova che il gateway è connesso: se lo status
  // webhook è andato perso, la sessione può restare bloccata su OFFLINE/QR
  // pur ricevendo regolarmente (e il worker outbound la blocca per
  // session_offline). Auto-guarigione qui, tranne per BANNED (stato definitivo).
  await db.waSession.update({
    where: { id: session.id },
    data: {
      lastSeenAt: new Date(),
      ...(session.status !== "CONNECTED" && session.status !== "BANNED"
        ? { status: "CONNECTED" }
        : {}),
    },
  });

  // Reply pipeline — fire-and-forget so the gateway gets a fast 200.
  // I gruppi non attivano MAI l'AI salvo opt-in esplicito (groupAutoReply).
  const groupBlocked = isGroup && !settings.sending.groupAutoReply;
  if (conversation.mode !== "MANUAL" && !groupBlocked) {
    const conversationId = conversation.id;
    void generateAndDeliverReply(conversationId).catch((e) => {
      console.error(`[webhook/wa] reply pipeline failed for ${conversationId}:`, e);
    });
  }
}

/**
 * Map a whatsapp-web.js-style numeric ACK onto our MessageStatus.
 * ACK_ERROR=-1, PENDING=0, SERVER=1, DEVICE=2 (delivered), READ=3, PLAYED=4.
 * Anything below DEVICE(2) is left alone (message already SENT, no update needed).
 */
function mapAckToStatus(ack: number): "DELIVERED" | "READ" | null {
  if (ack >= 3) return "READ";
  if (ack >= 2) return "DELIVERED";
  return null;
}

async function handleMessageAck(envelope: WebhookEnvelope): Promise<void> {
  const data = envelope.data ?? {};
  const waMessageId =
    typeof data.id === "string"
      ? data.id
      : typeof data.messageId === "string"
        ? data.messageId
        : null;
  const ack = typeof data.ack === "number" ? data.ack : null;
  if (!waMessageId || ack === null) return;

  const status = mapAckToStatus(ack);
  if (!status) return;

  // Never regress READ back to DELIVERED (out-of-order/duplicate ack delivery).
  await db.message.updateMany({
    where: {
      waMessageId,
      direction: "OUT",
      status: status === "READ" ? { in: ["SENT", "DELIVERED"] } : "SENT",
    },
    data: { status },
  });
}

async function handleSessionStatus(envelope: WebhookEnvelope): Promise<void> {
  const data = envelope.data ?? {};
  let rawStatus =
    typeof data.status === "string" ? data.status : null;
  if (!rawStatus && envelope.event === "session.authenticated") rawStatus = "ready";
  if (!rawStatus && envelope.event === "session.disconnected") rawStatus = "disconnected";
  if (!rawStatus) return;

  const mapped = mapGatewayStatus(rawStatus);
  if (!mapped) return;

  const session = await db.waSession.findFirst({
    where: { sessionDataRef: envelope.sessionId, deletedAt: null },
  });
  if (!session) return;

  await db.waSession.update({
    where: { id: session.id },
    data: { status: mapped, lastSeenAt: new Date() },
  });
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  if (!verifySignature(rawBody, req.headers.get(SIGNATURE_HEADER))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let envelope: WebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as WebhookEnvelope;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!envelope || typeof envelope.event !== "string" || typeof envelope.sessionId !== "string") {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  // --- Anti-replay ---------------------------------------------------------
  // La firma HMAC copre il raw body, e il body CONTIENE envelope.timestamp:
  // la firma quindi protegge già il timestamp, non serve cambiare lo schema di
  // firma (né toccare il gateway). Quello che mancava era una finestra di
  // validità: senza, un payload firmato intercettato una volta resta valido per
  // sempre e può essere rigiocato (il dedup copre solo message.received, non
  // message.ack né session.*).
  // Prudenza deliberata: rifiutiamo SOLO i timestamp leggibili e chiaramente
  // vecchi. Se il campo manca o non è parsabile lasciamo passare con un warning,
  // perché il formato lo decide il gateway e un fail-closed qui bloccherebbe
  // TUTTI i messaggi in ingresso — il danno peggiore possibile per questo bot.
  const ts = Date.parse(envelope.timestamp ?? "");
  if (Number.isNaN(ts)) {
    console.warn(`[webhook/wa] timestamp assente o non parsabile per ${envelope.event}`);
  } else {
    const skewMs = Math.abs(Date.now() - ts);
    if (skewMs > WEBHOOK_MAX_SKEW_MS) {
      console.warn(
        `[webhook/wa] scartato ${envelope.event}: timestamp fuori finestra (${Math.round(skewMs / 1000)}s)`
      );
      return Response.json({ error: "stale timestamp" }, { status: 401 });
    }
  }

  // --- Idempotenza: check-prima, marca-solo-dopo-successo ---
  // INVARIANTE: la riga WebhookDelivery si scrive SOLO dopo che l'evento è stato
  // processato con successo. Spostare la create prima del handler = regressione
  // che perde messaggi (un retry del gateway verrebbe scartato come "duplicato").
  // NB: deliveryId/idempotencyKey del gateway NON sono affidabili — il fork invia
  // una costante ("msg_unknown") per ogni messaggio, che farebbe scartare TUTTI i
  // messaggi dopo il primo come duplicati. Deriviamo quindi la chiave dal CONTENUTO:
  //  - message.received: id WA del messaggio (stabile tra i retry, unico per
  //    messaggio); se manca, hash del rawBody (payload identico ⇒ stesso messaggio).
  //  - message.ack: nessun dedup (handler idempotente; ack delivered/read con lo
  //    stesso id sono legittimi e non vanno collassati).
  //  - session.*: nessun dedup (heartbeat identici sono delivery diverse e
  //    l'handler di stato è idempotente).
  const dedupeData = envelope.data ?? {};
  const waMsgId =
    typeof dedupeData.id === "string"
      ? dedupeData.id
      : typeof dedupeData.messageId === "string"
        ? dedupeData.messageId
        : null;
  const dedupeKey =
    envelope.event === "message.received"
      ? `recv:${waMsgId ?? createHash("sha256").update(rawBody).digest("hex")}`
      : null;

  if (dedupeKey) {
    const seen = await db.webhookDelivery.findUnique({ where: { key: dedupeKey } });
    if (seen) return Response.json({ ok: true, deduped: true });
  }

  try {
    switch (envelope.event) {
      case "message.received":
        await handleMessageReceived(envelope);
        break;
      case "message.ack":
        await handleMessageAck(envelope);
        break;
      case "session.status":
      case "session.authenticated":
      case "session.disconnected":
        await handleSessionStatus(envelope);
        break;
      default:
        break; // ignore unhandled events (test, ...)
    }
  } catch (e) {
    console.error(`[webhook/wa] handler error for ${envelope.event}:`, e);
    // NIENTE dedup scritto → il retry del gateway ri-processa davvero.
    return Response.json({ error: "internal error" }, { status: 500 });
  }

  // Marca la delivery SOLO dopo processing riuscito. Best-effort, non-fatale:
  // un P2002 (retry concorrente) o un errore DB non deve trasformare un successo
  // in 500 (che causerebbe un ri-processing inutile).
  if (dedupeKey) {
    try {
      await db.webhookDelivery.create({ data: { key: dedupeKey } });
    } catch (e) {
      if (!(e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002")) {
        console.error("[webhook/wa] dedup mark failed (non-fatal):", e);
      }
    }
  }
  return Response.json({ ok: true });
}
