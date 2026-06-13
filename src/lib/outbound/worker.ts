/**
 * Worker della coda outbound. Invocato dall'endpoint interno /tick (cron).
 * Per ogni sessione con job dovuti prende al più `maxPerSessionPerTick` job
 * (default 1): la cadenza del cron impone lo spacing. Valuta i gate anti-ban
 * (pacing.ts), risolve il body (text/template/intent), invia via gateway,
 * crea il Message in inbox e aggiorna il job.
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { sendText } from "@/lib/wa/gateway-client";
import { getProvider } from "@/lib/ai";
import {
  getTenantSettings,
  buildSystemPrompt,
  isWithinSchedule,
  styleTemperature,
  lengthMaxTokens,
} from "@/lib/settings";
import { renderTemplate } from "./template";
import { evaluateSendEligibility, isJobDue, backoffDelayMs } from "./pacing";
import type { OutboundPayload } from "./types";

const MAX_PER_SESSION_PER_TICK = 1;

export interface DrainSummary {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function drainOutbound(now: Date = new Date()): Promise<DrainSummary> {
  const summary: DrainSummary = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  const dueJobs = await db.outboundJob.findMany({
    where: {
      status: "PENDING",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, sessionId: true },
  });
  const bySession = new Map<string, string[]>();
  for (const j of dueJobs) {
    if (!isJobDue(null, now)) continue;
    const arr = bySession.get(j.sessionId) ?? [];
    if (arr.length < MAX_PER_SESSION_PER_TICK) arr.push(j.id);
    bySession.set(j.sessionId, arr);
  }

  for (const [, jobIds] of bySession) {
    for (const jobId of jobIds) {
      summary.processed++;
      const res = await sendOneJob(jobId, now);
      summary[res]++;
    }
  }
  return summary;
}

type JobOutcome = "sent" | "failed" | "skipped";

export async function sendOneJob(jobId: string, now: Date): Promise<JobOutcome> {
  const lock = await db.outboundJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "SENDING" },
  });
  if (lock.count === 0) return "skipped";

  const job = await db.outboundJob.findUnique({
    where: { id: jobId },
    include: { session: true, contact: true },
  });
  if (!job) return "skipped";

  const settings = await getTenantSettings(job.tenantId);

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfHour = new Date(now);
  startOfHour.setMinutes(0, 0, 0);
  const [sentToday, sentThisHour, lastOut] = await Promise.all([
    db.message.count({
      where: {
        tenantId: job.tenantId,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: startOfDay },
      },
    }),
    db.message.count({
      where: {
        tenantId: job.tenantId,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: startOfHour },
      },
    }),
    db.message.findFirst({
      where: {
        tenantId: job.tenantId,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const inbound = await db.message.count({
    where: { conversation: { contactId: job.contactId }, direction: "IN" },
  });
  const optedIn = job.contact.optInStatus === "IN" || inbound > 0;

  const decision = evaluateSendEligibility({
    sessionStatus: job.session.status,
    optedIn,
    sentToday,
    dailyCap: settings.sending.dailyCap,
    sentThisHour,
    hourlyCap: settings.sending.hourlyCap,
    lastSendAt: lastOut?.createdAt ?? null,
    minSpacingMs: settings.sending.delayMinMs,
    now,
    businessHoursOnlyOutbound: settings.sending.businessHoursOnlyOutbound,
    withinHours: isWithinSchedule(settings.hours, now),
    pauseOnRisk: settings.sending.pauseOnRisk,
  });

  if (!decision.ok) {
    if (decision.retryAfterMs) {
      await db.outboundJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          scheduledAt: new Date(now.getTime() + decision.retryAfterMs),
          lastError: decision.reason,
        },
      });
    } else {
      await db.outboundJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: decision.reason },
      });
      await auditLog({
        tenantId: job.tenantId,
        action: "outbound.skipped",
        entity: "OutboundJob",
        entityId: job.id,
        meta: { reason: decision.reason, contactId: job.contactId },
      });
    }
    return "skipped";
  }

  let body: string;
  try {
    body = await resolveBody(job, settings);
  } catch (e) {
    return await markFailed(job.id, job.tenantId, job.attempts, job.maxAttempts, now, e);
  }
  if (!body.trim()) {
    return await markFailed(job.id, job.tenantId, job.attempts, job.maxAttempts, now, new Error("empty body"));
  }

  const conversationId =
    job.conversationId ??
    (await ensureConversationFor(job.tenantId, job.contactId, job.sessionId));

  try {
    const gwId = job.session.sessionDataRef;
    if (!gwId) throw new Error("session has no gateway ref");
    await sendText(gwId, job.contact.phone ?? job.contact.waId, body);

    const message = await db.message.create({
      data: {
        conversationId,
        tenantId: job.tenantId,
        direction: "OUT",
        body,
        status: "SENT",
        aiGenerated: job.mode === "INTENT",
        source: job.source,
      },
      select: { id: true },
    });
    await db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    });
    await db.outboundJob.update({
      where: { id: job.id },
      data: { status: "DONE", sentAt: now, messageId: message.id, conversationId },
    });
    await auditLog({
      tenantId: job.tenantId,
      action: "outbound.sent",
      entity: "OutboundJob",
      entityId: job.id,
      meta: { contactId: job.contactId, source: job.source, campaignId: job.campaignId },
    });
    return "sent";
  } catch (e) {
    return await markFailed(job.id, job.tenantId, job.attempts, job.maxAttempts, now, e);
  }
}

async function ensureConversationFor(
  tenantId: string,
  contactId: string,
  sessionId: string
): Promise<string> {
  const { ensureConversation } = await import("./enqueue");
  return ensureConversation(tenantId, contactId, sessionId);
}

async function resolveBody(
  job: {
    mode: string;
    payload: unknown;
    tenantId: string;
    contact: { name: string | null; profileSummary: string | null };
  },
  settings: Awaited<ReturnType<typeof getTenantSettings>>
): Promise<string> {
  const payload = job.payload as OutboundPayload;
  if (payload.mode === "TEXT") return payload.text;

  if (payload.mode === "TEMPLATE") {
    const tpl = await db.template.findFirst({
      where: { id: payload.templateId, tenantId: job.tenantId, deletedAt: null },
      select: { body: true },
    });
    if (!tpl) throw new Error(`template ${payload.templateId} not found`);
    const vars: Record<string, string> = {
      nome: job.contact.name ?? "",
      ...payload.vars,
    };
    return renderTemplate(tpl.body, vars);
  }

  const aiConfig = await db.aiConfig.findUnique({ where: { tenantId: job.tenantId } });
  if (!aiConfig) throw new Error("no AiConfig for intent compose");
  const system = buildSystemPrompt(settings, {
    contactSummary: [
      job.contact.name ? `Stai scrivendo a: ${job.contact.name}.` : null,
      job.contact.profileSummary,
    ]
      .filter(Boolean)
      .join("\n"),
    outsideBusinessHours: false,
  });
  const ctx = payload.context ? `\nContesto: ${JSON.stringify(payload.context)}` : "";
  const provider = getProvider({ provider: aiConfig.provider });
  const result = await provider.generate({
    system: `${system}\n\nComponi un singolo messaggio WhatsApp in uscita (no preamboli).`,
    messages: [{ role: "user", content: `Intento: ${payload.intent}${ctx}` }],
    modelId: aiConfig.modelId,
    temperature: styleTemperature(settings.behavior.responseStyle),
    maxTokens: lengthMaxTokens(settings.behavior.maxResponseLength),
  });
  return result.text.trim();
}

async function markFailed(
  jobId: string,
  tenantId: string,
  attempts: number,
  maxAttempts: number,
  now: Date,
  e: unknown
): Promise<JobOutcome> {
  const nextAttempts = attempts + 1;
  const error = e instanceof Error ? e.message : String(e);
  if (nextAttempts >= maxAttempts) {
    await db.outboundJob.update({
      where: { id: jobId },
      data: { status: "FAILED", attempts: nextAttempts, lastError: error },
    });
    await auditLog({
      tenantId,
      action: "outbound.failed",
      entity: "OutboundJob",
      entityId: jobId,
      meta: { error, attempts: nextAttempts },
    });
    return "failed";
  }
  await db.outboundJob.update({
    where: { id: jobId },
    data: {
      status: "PENDING",
      attempts: nextAttempts,
      lastError: error,
      scheduledAt: new Date(now.getTime() + backoffDelayMs(nextAttempts)),
    },
  });
  return "failed";
}
