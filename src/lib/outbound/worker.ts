/**
 * Worker della coda outbound. Invocato dall'endpoint interno /tick (cron).
 * Per ogni sessione con job dovuti prende al più `maxPerSessionPerTick` job
 * (default 1): la cadenza del cron impone lo spacing. Valuta i gate anti-ban
 * (pacing.ts), risolve il body (text/template/intent), invia via gateway,
 * crea il Message in inbox e aggiorna il job.
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { sendText, contactChatId, GatewayError } from "@/lib/wa/gateway-client";
import { getProvider } from "@/lib/ai";
import {
  buildSystemPrompt,
  isWithinSchedule,
  styleTemperature,
  lengthMaxTokens,
  sanitizePromptField,
} from "@/lib/settings";
import { getSessionSettings } from "@/lib/settings/session";
import { renderTemplate } from "./template";
import { evaluateSendEligibility, isJobExpired, backoffDelayMs } from "./pacing";
import type { OutboundPayload } from "./types";

const MAX_PER_SESSION_PER_TICK = 1;
/** Un job in SENDING più vecchio di così = processo morto tra lock e record:
 *  lo marchiamo FAILED (fail-closed, MAI re-inviato → consegna at-most-once). */
const STALE_SENDING_MS = 5 * 60_000;
/** Oltre questa età un job ancora non inviato viene terminato (evita retry
 *  infiniti su sessione offline). 7 giorni: deve coprire weekend/festivi,
 *  quando businessHoursOnlyOutbound rimanda al prossimo orario lavorativo —
 *  un valore più basso (es. 24h) scarterebbe i messaggi accodati di sabato. */
const MAX_JOB_AGE_MS = 7 * 24 * 3_600_000;

export interface DrainSummary {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function drainOutbound(now: Date = new Date()): Promise<DrainSummary> {
  const summary: DrainSummary = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  // FIX B: il cron gira ogni minuto ma un drain può durare più a lungo; senza
  // questo lock due drain concorrenti leggerebbero gli stessi contatori di
  // pacing (sentToday/sentThisHour) prima che l'altro scriva, sforando i cap
  // anti-ban. Un secondo drain concorrente esce subito senza fare nulla.
  const [{ locked }] = await db.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext('openwa_outbound_drain')) AS locked
  `;
  if (!locked) return summary;

  try {
    // Purge best-effort delle WebhookDelivery vecchie (dedup idempotenza webhook):
    // oltre 7gg non serve più per il dedup, e senza questo la tabella cresce
    // illimitatamente. Best-effort: un fallimento qui non deve bloccare il drain.
    await db.webhookDelivery
      .deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * 24 * 3600_000) } } })
      .catch(() => {});

    // Recupero job orfani: un SENDING bloccato da troppo (processo morto tra il
    // lock e la scrittura del Message) NON viene re-inviato — rischio duplicato —
    // ma marcato FAILED; l'app/campagna lo vede e può ripianificarlo.
    await db.outboundJob.updateMany({
      where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
      data: { status: "FAILED", lastError: "stuck_in_sending" },
    });

    // FIX C: cap esplicito. Al più 1 job/sessione/tick viene comunque preso,
    // ma senza LIMIT la query dei PENDING dovuti scansiona l'intera coda; 500
    // copre ampiamente il numero di sessioni distinte in un singolo tenant/tick.
    const dueJobs = await db.outboundJob.findMany({
      where: {
        status: "PENDING",
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, sessionId: true },
      take: 500,
    });
    const bySession = new Map<string, string[]>();
    for (const j of dueJobs) {
      const arr = bySession.get(j.sessionId) ?? [];
      if (arr.length < MAX_PER_SESSION_PER_TICK) arr.push(j.id);
      bySession.set(j.sessionId, arr);
    }

    for (const [, jobIds] of bySession) {
      for (const jobId of jobIds) {
        summary.processed++;
        // FIX A: un job che lancia non deve abortire l'intero drain (altrimenti
        // il job resta lockato in SENDING e i job successivi non vengono processati).
        try {
          const res = await sendOneJob(jobId, now);
          summary[res]++;
        } catch (e) {
          console.error("[outbound] sendOneJob threw, continuing drain:", jobId, e);
          summary.failed++;
        }
      }
    }
    return summary;
  } finally {
    await db.$executeRaw`SELECT pg_advisory_unlock(hashtext('openwa_outbound_drain'))`;
  }
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

  if (isJobExpired(job.createdAt, now, MAX_JOB_AGE_MS)) {
    await db.outboundJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: "expired" },
    });
    await auditLog({
      tenantId: job.tenantId,
      action: "outbound.expired",
      entity: "OutboundJob",
      entityId: job.id,
      meta: { contactId: job.contactId, ageMs: now.getTime() - job.createdAt.getTime() },
    });
    return "failed";
  }

  const settings = await getSessionSettings(job.sessionId);

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfHour = new Date(now);
  startOfHour.setMinutes(0, 0, 0);
  // NB: cap e spacing sono aggregati PER-SESSIONE (numero) — ogni numero ha i
  // propri limiti anti-ban, condivisi con le risposte AI in entrata del numero.
  const sessionFilter = { conversation: { sessionId: job.sessionId } } as const;
  const [sentToday, sentThisHour, lastOut] = await Promise.all([
    db.message.count({
      where: {
        ...sessionFilter,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: startOfDay },
      },
    }),
    db.message.count({
      where: {
        ...sessionFilter,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: startOfHour },
      },
    }),
    db.message.findFirst({
      where: {
        ...sessionFilter,
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
  const optedIn =
    job.contact.optInStatus !== "OUT" &&
    (job.contact.optInStatus === "IN" || inbound > 0);

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
  const finalBody = body.slice(0, 4096);

  const conversationId =
    job.conversationId ??
    (await ensureConversationFor(job.tenantId, job.contactId, job.sessionId));

  // C3: chat id di destinazione corretto (telefono reale, o @lid/@c.us dal waId).
  // Se non è calcolabile (LID non risolto senza telefono) NON inviamo: FAILED.
  const chatId = contactChatId(job.contact);
  if (!chatId) {
    return await markFailedNoRetry(job.id, job.tenantId, "unsendable_chat_id");
  }

  // ── Fase 1: INVIO (isolato). Un fallimento qui è classificato: ──────────────
  //  - GatewayError SENZA status = timeout/network dopo che la richiesta è
  //    partita → consegna AMBIGUA → fail-closed, MAI ri-inviato (at-most-once).
  //  - qualsiasi altro errore (ref mancante, GatewayError con 4xx/5xx = rifiuto
  //    pre-consegna) → retry con backoff come prima.
  try {
    const gwId = job.session.sessionDataRef;
    if (!gwId) throw new Error("session has no gateway ref");
    await sendText(gwId, chatId, finalBody);
  } catch (e) {
    if (e instanceof GatewayError && e.status === undefined) {
      return await markFailedNoRetry(job.id, job.tenantId, "send_ambiguous");
    }
    return await markFailed(job.id, job.tenantId, job.attempts, job.maxAttempts, now, e);
  }

  // ── Fase 2: scritture POST-INVIO (separate). Il messaggio È stato inviato: un
  //  errore qui NON deve mai ri-schedulare (= re-invio). Lasciamo il job in
  //  SENDING: il reaper stale-SENDING lo marcherà FAILED (fail-closed). ────────
  try {
    const message = await db.message.create({
      data: {
        conversationId,
        tenantId: job.tenantId,
        direction: "OUT",
        body: finalBody,
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
    // Inviato ma la persistenza è fallita: NON re-inviare. Restiamo in SENDING
    // (il reaper marcherà FAILED dopo STALE_SENDING_MS) e lo tracciamo in audit.
    const error = e instanceof Error ? e.message : String(e);
    console.error("[outbound] post-send write failed (message already sent):", error);
    await auditLog({
      tenantId: job.tenantId,
      action: "outbound.postSendFailed",
      entity: "OutboundJob",
      entityId: job.id,
      meta: { error, contactId: job.contactId },
    }).catch(() => {});
    return "sent";
  }
}

/** Marca un job FAILED in modo TERMINALE (nessun retry): usato quando un
 *  re-invio sarebbe rischioso (consegna ambigua) o impossibile (no chat id). */
async function markFailedNoRetry(
  jobId: string,
  tenantId: string,
  reason: string
): Promise<JobOutcome> {
  await db.outboundJob.update({
    where: { id: jobId },
    data: { status: "FAILED", lastError: reason },
  });
  await auditLog({
    tenantId,
    action: "outbound.failed",
    entity: "OutboundJob",
    entityId: jobId,
    meta: { reason, noRetry: true },
  });
  return "failed";
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
    sessionId: string;
    contact: { name: string | null; profileSummary: string | null };
  },
  settings: Awaited<ReturnType<typeof getSessionSettings>>
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

  const aiConfig = await db.aiConfig.findUnique({ where: { sessionId: job.sessionId } });
  if (!aiConfig) throw new Error("no AiConfig for intent compose");
  const system = buildSystemPrompt(settings, {
    contactSummary: [
      job.contact.name ? `Stai scrivendo a: ${sanitizePromptField(job.contact.name, 80)}.` : null,
      sanitizePromptField(job.contact.profileSummary, 500) || null,
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
