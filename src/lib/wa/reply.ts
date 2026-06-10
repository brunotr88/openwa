/**
 * AI reply pipeline (spec §6 inbound, §8 reply modes).
 *
 * generateAndDeliverReply(conversationId):
 * - loads conversation + last messages + AiConfig + Contact.profileSummary
 * - builds the system prompt (tenant systemPrompt + contact summary)
 * - AUTO  → Message(OUT, QUEUED, aiGenerated) → gateway sendText → SENT/FAILED
 * - COPILOT (or AUTO outside business hours / autoReply disabled) →
 *   Message(OUT, DRAFT, aiGenerated) for operator approval
 * - MANUAL → no AI action
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getProvider, type ChatMsg } from "@/lib/ai";
import { sendText } from "./gateway-client";

const HISTORY_LIMIT = 20;

export interface BusinessHours {
  timezone?: string;
  days?: number[]; // 0 (Sun) .. 6 (Sat)
  // numeric shape (validators.ts): startHour/endHour
  startHour?: number;
  endHour?: number;
  // string shape: "09:00" / "18:00"
  start?: string;
  end?: string;
}

function parseHour(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** True when `now` falls inside the configured business hours (or none set). */
export function isWithinBusinessHours(
  businessHours: unknown,
  now: Date = new Date()
): boolean {
  if (!businessHours || typeof businessHours !== "object") return true;
  const bh = businessHours as BusinessHours;

  let day = now.getDay();
  let hour = now.getHours() + now.getMinutes() / 60;

  if (bh.timezone) {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: bh.timezone,
        weekday: "short",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
      const h = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
      const min = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
      const idx = dayNames.indexOf(wd);
      if (idx >= 0 && !Number.isNaN(h)) {
        day = idx;
        hour = (h % 24) + min / 60;
      }
    } catch {
      // invalid timezone → fall back to server-local time
    }
  }

  if (Array.isArray(bh.days) && bh.days.length > 0 && !bh.days.includes(day)) {
    return false;
  }

  const start = typeof bh.startHour === "number" ? bh.startHour : parseHour(bh.start);
  const end = typeof bh.endHour === "number" ? bh.endHour : parseHour(bh.end);
  if (start === null || end === null || start === undefined || end === undefined) {
    return true; // hours not configured → only day filter applies
  }
  return hour >= start && hour < end;
}

function buildSystemPrompt(
  tenantSystemPrompt: string | null | undefined,
  contactName: string | null | undefined,
  profileSummary: string | null | undefined
): string {
  const parts: string[] = [];
  parts.push(
    tenantSystemPrompt?.trim() ||
      "Sei un assistente WhatsApp professionale. Rispondi in modo conciso e cortese nella lingua del cliente."
  );
  if (contactName) parts.push(`Stai parlando con: ${contactName}.`);
  if (profileSummary) parts.push(`Note sul contatto:\n${profileSummary}`);
  return parts.join("\n\n");
}

/**
 * Generates an AI reply for the conversation and delivers it according to
 * the conversation mode. Returns the created Message id, or null when no
 * action was taken (MANUAL mode, missing config, empty history...).
 */
export async function generateAndDeliverReply(
  conversationId: string
): Promise<string | null> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      contact: true,
      session: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        where: { status: { not: "DRAFT" } },
      },
    },
  });
  if (!conversation) return null;
  if (conversation.mode === "MANUAL") return null;

  const aiConfig = await db.aiConfig.findUnique({
    where: { tenantId: conversation.tenantId },
  });
  if (!aiConfig) return null;

  // Oldest-first history → ChatMsg[]
  const history: ChatMsg[] = [...conversation.messages]
    .reverse()
    .filter((m) => (m.body ?? "").trim().length > 0)
    .map((m) => ({
      role: m.direction === "IN" ? ("user" as const) : ("assistant" as const),
      content: m.body as string,
    }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return null; // nothing to reply to
  }

  const system = buildSystemPrompt(
    aiConfig.systemPrompt,
    conversation.contact.name,
    conversation.contact.profileSummary
  );

  const provider = getProvider({ provider: aiConfig.provider });
  const result = await provider.generate({
    system,
    messages: history,
    modelId: aiConfig.modelId,
    temperature: aiConfig.temperature,
  });

  const text = result.text.trim();
  if (!text) return null;

  // AUTO requires: conversation AUTO + tenant autoReplyEnabled + business hours.
  // Otherwise degrade to COPILOT behaviour (draft for the operator).
  const autoAllowed =
    conversation.mode === "AUTO" &&
    aiConfig.autoReplyEnabled &&
    isWithinBusinessHours(aiConfig.businessHours);

  if (!autoAllowed) {
    const draft = await db.message.create({
      data: {
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        direction: "OUT",
        body: text,
        status: "DRAFT",
        aiGenerated: true,
        source: "WA",
      },
    });
    await auditLog({
      tenantId: conversation.tenantId,
      action: "ai.reply.draft",
      entity: "Message",
      entityId: draft.id,
      meta: { conversationId: conversation.id, mode: conversation.mode },
    });
    return draft.id;
  }

  // AUTO: queue, send via gateway, mark SENT/FAILED.
  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      direction: "OUT",
      body: text,
      status: "QUEUED",
      aiGenerated: true,
      source: "WA",
    },
  });

  const gwSessionId = conversation.session.sessionDataRef;
  try {
    if (!gwSessionId) {
      throw new Error(`WaSession ${conversation.sessionId} has no gateway session ref`);
    }
    await sendText(gwSessionId, conversation.contact.waId, text);
    await db.message.update({
      where: { id: message.id },
      data: { status: "SENT" },
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
    await auditLog({
      tenantId: conversation.tenantId,
      action: "ai.reply.sent",
      entity: "Message",
      entityId: message.id,
      meta: { conversationId: conversation.id },
    });
  } catch (e) {
    console.error("[reply] gateway send failed:", e);
    await db.message.update({
      where: { id: message.id },
      data: { status: "FAILED" },
    });
    await auditLog({
      tenantId: conversation.tenantId,
      action: "ai.reply.failed",
      entity: "Message",
      entityId: message.id,
      meta: {
        conversationId: conversation.id,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }

  return message.id;
}
