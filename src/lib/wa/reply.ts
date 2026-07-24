/**
 * AI reply pipeline (spec §6 inbound, §8 reply modes, M4 TenantSettings).
 *
 * generateAndDeliverReply(conversationId):
 * - loads conversation + history (TenantSettings.historyMessages) + AiConfig
 *   + TenantSettings + Contact.profileSummary
 * - builds the system prompt via buildSystemPrompt(settings, contactSummary)
 * - aiMode OFF → no AI at all; MANUAL conversation → no AI
 * - escalation guards force DRAFT even in AUTO:
 *   keyword match on the inbound text, maxAiTurns (consecutive AI replies
 *   without a human), dailyCap (today's OUT sent), afterHoursMode
 * - AUTO  → optional random human-like delay → gateway sendText → SENT/FAILED
 * - COPILOT (or any guard tripped) → Message(OUT, DRAFT, aiGenerated)
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getProvider, type ChatMsg } from "@/lib/ai";
import { runWithTools } from "@/lib/ai/tool-loop";
import { getCalendarProvider } from "@/lib/appointments";
import {
  appointmentSystemPrompt,
  buildAppointmentTools,
} from "@/lib/appointments/tools";
import {
  buildSystemPrompt,
  matchEscalationKeyword,
  autoSendAllowedNow,
  isWithinSchedule,
  styleTemperature,
  lengthMaxTokens,
  sanitizePromptField,
  type TenantSettings,
} from "@/lib/settings";
import { getSessionSettings } from "@/lib/settings/session";
import { zonedDate, zonedToUtc } from "@/lib/appointments/slots";
import { sendText, contactChatId } from "./gateway-client";

/** Hard cap sul ritardo "umano" prima dell'invio (whatsapp-ops: max 10 s). */
const MAX_RANDOM_DELAY_MS = 10_000;

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

/**
 * Legacy AiConfig.businessHours check (pre-M4). Kept for the existing
 * numeric/string shapes; the live pipeline now uses TenantSettings.hours
 * (autoSendAllowedNow in lib/settings).
 */
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ritardo casuale 3-8 s (configurabile, cap 10 s) per simulare un operatore. */
async function humanDelay(settings: TenantSettings): Promise<void> {
  if (!settings.sending.randomDelay) return;
  const min = Math.min(settings.sending.delayMinMs, MAX_RANDOM_DELAY_MS);
  const max = Math.min(
    Math.max(settings.sending.delayMaxMs, min),
    MAX_RANDOM_DELAY_MS
  );
  const ms = Math.floor(min + Math.random() * (max - min));
  if (ms > 0) await sleep(ms);
}

/**
 * Conta le risposte AI consecutive (OUT aiGenerated) senza intervento umano,
 * a partire dal messaggio più recente. Un OUT scritto da un umano azzera.
 */
export function countConsecutiveAiTurns(
  messagesNewestFirst: Array<{ direction: string; aiGenerated: boolean }>
): number {
  let count = 0;
  for (const m of messagesNewestFirst) {
    if (m.direction !== "OUT") continue;
    if (!m.aiGenerated) break; // un umano è intervenuto
    count += 1;
  }
  return count;
}

/**
 * Generates an AI reply for the conversation and delivers it according to
 * the conversation mode + tenant settings. Returns the created Message id,
 * or null when no action was taken (OFF/MANUAL, missing config...).
 */
export async function generateAndDeliverReply(
  conversationId: string
): Promise<string | null> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true, session: true },
  });
  if (!conversation) return null;
  if (conversation.mode === "MANUAL") return null;

  // ── Claim atomico anti-race (FIX 2) ───────────────────────────────────────
  // 2 messaggi ravvicinati possono avviare 2 run paralleli di questa funzione
  // per la stessa conversazione, entrambi vedendo l'ultimo messaggio come
  // 'user' → doppia risposta. Serializziamo con una colonna claim (replyingAt)
  // invece di un advisory lock raw (mockabile nei test). Un claim scaduto
  // (>2 min, processo morto) può essere ripreso da un run successivo.
  const claimNow = new Date();
  const claim = await db.conversation.updateMany({
    where: {
      id: conversationId,
      OR: [
        { replyingAt: null },
        { replyingAt: { lt: new Date(claimNow.getTime() - 2 * 60_000) } },
      ],
    },
    data: { replyingAt: claimNow },
  });
  if (claim.count === 0) return null; // un'altra reply è già in corso

  try {
    return await generateAndDeliverReplyLocked(conversation, conversationId);
  } finally {
    await db.conversation
      .update({ where: { id: conversationId }, data: { replyingAt: null } })
      .catch(() => {});
  }
}

type ConversationWithContactAndSession = NonNullable<
  Awaited<
    ReturnType<
      typeof db.conversation.findUnique<{
        where: { id: string };
        include: { contact: true; session: true };
      }>
    >
  >
>;

async function generateAndDeliverReplyLocked(
  conversation: ConversationWithContactAndSession,
  conversationId: string
): Promise<string | null> {
  const settings = await getSessionSettings(conversation.sessionId);
  if (settings.behavior.aiMode === "OFF") return null;

  const aiConfig = await db.aiConfig.findUnique({
    where: { sessionId: conversation.sessionId },
  });
  if (!aiConfig) return null;

  const recent = await db.message.findMany({
    where: {
      conversationId: conversation.id,
      status: { notIn: ["DRAFT", "FAILED", "QUEUED"] },
    },
    orderBy: { createdAt: "desc" },
    take: settings.behavior.historyMessages,
  });

  // Oldest-first history → ChatMsg[]
  const history: ChatMsg[] = [...recent]
    .reverse()
    .filter((m) => (m.body ?? "").trim().length > 0)
    .map((m) => ({
      role: m.direction === "IN" ? ("user" as const) : ("assistant" as const),
      content: m.body as string,
    }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return null; // nothing to reply to
  }

  // ── Escalation guards (force DRAFT even in AUTO) ──────────────────────────
  const lastContent = history[history.length - 1].content;
  const lastInbound = typeof lastContent === "string" ? lastContent : "";
  const matchedKeyword = matchEscalationKeyword(
    lastInbound,
    settings.behavior.escalationKeywords
  );
  const aiTurns = countConsecutiveAiTurns(recent);
  const maxTurnsReached = aiTurns >= settings.behavior.maxAiTurns;

  // Cap giornaliero calcolato nel fuso orario del tenant (settings.hours.timezone),
  // non nel fuso del server: "inizio di oggi" = mezzanotte locale del tenant.
  const tz = settings.hours.timezone;
  const today = zonedDate(new Date(), tz);
  const startOfDay = zonedToUtc(today.y, today.m, today.d, 0, 0, tz);
  const sentToday = await db.message.count({
    where: {
      conversation: { sessionId: conversation.sessionId },
      direction: "OUT",
      aiGenerated: true,
      status: { in: ["SENT", "DELIVERED", "READ"] },
      createdAt: { gte: startOfDay },
    },
  });
  const dailyCapReached = sentToday >= settings.sending.dailyCap;

  let system = buildSystemPrompt(settings, {
    contactSummary: [
      conversation.contact.name
        ? `Stai parlando con: ${sanitizePromptField(conversation.contact.name, 80)}.`
        : null,
      sanitizePromptField(conversation.contact.profileSummary, 500) || null,
    ]
      .filter(Boolean)
      .join("\n"),
    outsideBusinessHours: !isWithinSchedule(settings.hours),
  });

  // Appuntamenti (M5): istruzioni nel prompt (Calendly link o tool Google).
  const apptPrompt = appointmentSystemPrompt(settings);
  if (apptPrompt) system = `${system}\n\n${apptPrompt}`;

  // Auto-invio richiede: la conversazione impostata esplicitamente su AUTO
  // (interruttore "live" per-conversazione) + l'AI non globalmente spenta
  // (aiMode != OFF) + orari ok + nessuna guardia di escalation. Così il
  // globale può restare COPILOT (tutti i clienti in bozza) e SOLO le
  // conversazioni messe su AUTO a mano rispondono live. Le conversazioni
  // nuove nascono con mode = aiMode (COPILOT) → restano bozze.
  // Calcolato PRIMA della generazione: il tool prenotazione non deve creare
  // eventi reali per bozze non approvate.
  // (aiMode OFF è già gestito sopra con un return: qui è AUTO o COPILOT, e la
  //  conversazione su AUTO è di per sé l'opt-in "live" esplicito.)
  const autoAllowed =
    conversation.mode === "AUTO" &&
    autoSendAllowedNow(settings.hours) &&
    !matchedKeyword &&
    !maxTurnsReached &&
    !dailyCapReached;

  const provider = getProvider({ provider: aiConfig.provider });
  const generateInput = {
    system,
    messages: history,
    modelId: aiConfig.modelId,
    temperature: styleTemperature(settings.behavior.responseStyle),
    maxTokens: lengthMaxTokens(settings.behavior.maxResponseLength),
  };

  // Appuntamenti Google (M5): tool-loop con check_availability/book_appointment.
  const calendar = getCalendarProvider(settings);
  let result;
  if (calendar) {
    const { tools, executors } = buildAppointmentTools({
      settings,
      calendar,
      allowBooking: autoAllowed,
      contact: {
        name: conversation.contact.name,
        phone: conversation.contact.waId,
      },
      onBooked: (booked) =>
        auditLog({
          tenantId: conversation.tenantId,
          action: "appointment.created",
          entity: "CalendarEvent",
          entityId: booked.eventId,
          meta: {
            conversationId: conversation.id,
            contactId: conversation.contact.id,
            start: booked.start.toISOString(),
            end: booked.end.toISOString(),
            title: booked.title,
            ...(booked.htmlLink ? { htmlLink: booked.htmlLink } : {}),
          },
        }),
    });
    result = await runWithTools(
      provider,
      {
        ...generateInput,
        // Le tool call consumano token extra: alza il tetto minimo.
        maxTokens: Math.max(generateInput.maxTokens, 600),
        tools,
      },
      executors
    );
  } else {
    result = await provider.generate(generateInput);
  }

  const text = result.text.trim();
  if (!text) return null;

  // ── FIX 2c: re-check anti-staleness prima di inviare in AUTO ──────────────
  // Tra l'inizio della generazione (chiamata LLM, potenzialmente lenta) e ora,
  // può essere arrivato un nuovo messaggio (IN dal contatto, o OUT da un
  // operatore/altra run). Se l'ultimo messaggio non-DRAFT/FAILED/QUEUED non è
  // più quello a cui stavamo rispondendo, la risposta generata è ormai stale:
  // non inviarla (finirà comunque come DRAFT più sotto se autoAllowed).
  if (autoAllowed) {
    const latest = await db.message.findFirst({
      where: {
        conversationId: conversation.id,
        status: { notIn: ["DRAFT", "FAILED", "QUEUED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const stillCurrent = recent.length === 0 ? latest === null : latest?.id === recent[0].id;
    if (!stillCurrent) return null;
  }

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
      action: matchedKeyword
        ? "ai.escalation.keyword"
        : maxTurnsReached
          ? "ai.escalation.maxTurns"
          : dailyCapReached
            ? "ai.cap.daily"
            : "ai.reply.draft",
      entity: "Message",
      entityId: draft.id,
      meta: {
        conversationId: conversation.id,
        mode: conversation.mode,
        ...(matchedKeyword ? { keyword: matchedKeyword } : {}),
        ...(maxTurnsReached ? { aiTurns } : {}),
        ...(dailyCapReached ? { sentToday, dailyCap: settings.sending.dailyCap } : {}),
      },
    });
    return draft.id;
  }

  // AUTO: queue, human-like delay, send via gateway, mark SENT/FAILED.
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
    const chatId = contactChatId(conversation.contact);
    if (!chatId) {
      throw new Error(`contact ${conversation.contact.id} has no sendable chat id`);
    }
    await humanDelay(settings);
    await sendText(gwSessionId, chatId, text);
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
