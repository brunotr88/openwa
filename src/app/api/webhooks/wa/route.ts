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
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { generateAndDeliverReply } from "@/lib/wa/reply";
import { shouldIgnoreInbound, normalizeWaId } from "@/lib/wa/inbound-filter";
import { getContact } from "@/lib/wa/gateway-client";
import { mapGatewayContact, resolutionPatch } from "@/lib/wa/contact-resolve";
import { getSessionSettings } from "@/lib/settings/session";
import type { WaSessionStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

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

/** Map gateway session status strings onto our WaSessionStatus enum. */
function mapGatewayStatus(status: string): WaSessionStatus | null {
  switch (status) {
    case "ready":
    case "connected":
      return "CONNECTED";
    case "qr_ready":
    case "qr":
      return "QR";
    case "disconnected":
    case "logged_out":
    case "failed":
      return "OFFLINE";
    default:
      // initializing / authenticating: transient — keep current status
      return null;
  }
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
  const body = typeof data.body === "string" ? data.body : "";
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
    conversation = await db.conversation.create({
      data: {
        tenantId: session.tenantId,
        contactId: contact.id,
        sessionId: session.id,
        mode: defaultMode,
        status: "OPEN",
      },
    });
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
  await db.waSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
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

  try {
    switch (envelope.event) {
      case "message.received":
        await handleMessageReceived(envelope);
        break;
      case "session.status":
      case "session.authenticated":
      case "session.disconnected":
        await handleSessionStatus(envelope);
        break;
      default:
        break; // ignore unhandled events (test, message.ack, ...)
    }
  } catch (e) {
    // Always 200 after signature check: gateway retries won't help app-side bugs.
    console.error(`[webhook/wa] handler error for ${envelope.event}:`, e);
  }

  return Response.json({ ok: true });
}
