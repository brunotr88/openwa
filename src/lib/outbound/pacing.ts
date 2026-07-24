/**
 * Logica anti-ban pura (spec §7). Nessun accesso a DB/rete: prende uno
 * stato (SendGate) e decide se inviare ora. Ordine dei gate: ban → opt-in →
 * cap giornaliero → cap orario → spacing → orari.
 */
import type { SendGate, SendDecision } from "./types";

export function isJobDue(scheduledAt: Date | null, now: Date): boolean {
  if (!scheduledAt) return true;
  return scheduledAt.getTime() <= now.getTime();
}

/** Backoff esponenziale: 2^attempts * 30s, cap 1h. */
export function backoffDelayMs(attempts: number): number {
  const ms = Math.pow(2, Math.max(0, attempts)) * 30_000;
  return Math.min(ms, 3_600_000);
}

/** True se il job è più vecchio di maxAgeMs (per terminare i retry infiniti). */
export function isJobExpired(createdAt: Date, now: Date, maxAgeMs: number): boolean {
  return now.getTime() - createdAt.getTime() > maxAgeMs;
}

/** Frazioni del cap configurato applicate durante il rodaggio (giorno 0 → 13). */
const WARMUP_RAMP = [0.1, 0.1, 0.15, 0.15, 0.2, 0.2, 0.3, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 0.85];
const WARMUP_DAYS = WARMUP_RAMP.length;

/**
 * sending.warmupMode: sui numeri connessi da meno di WARMUP_DAYS giorni
 * restringe i cap giornaliero/orario a una frazione crescente del limite
 * configurato, per non partire da subito a pieno volume (causa n.1 di ban).
 * Dopo WARMUP_DAYS il cap configurato si applica per intero.
 */
export function applyWarmupCap(configuredCap: number, sessionAgeDays: number): number {
  if (sessionAgeDays >= WARMUP_DAYS) return configuredCap;
  const day = Math.max(0, Math.floor(sessionAgeDays));
  const fraction = WARMUP_RAMP[day] ?? 1;
  return Math.max(1, Math.round(configuredCap * fraction));
}

export function evaluateSendEligibility(g: SendGate): SendDecision {
  if (g.sessionStatus === "BANNED") {
    // Ban confermato: stop definitivo, mai ritentare (anti-ban). pauseOnRisk
    // governa eventuali pause su rischio-scoring, non l'onorare un ban certo.
    return { ok: false, reason: "session_banned" };
  }
  if (g.sessionStatus !== "CONNECTED") {
    return { ok: false, reason: "session_offline", retryAfterMs: 60_000 };
  }
  if (!g.optedIn) {
    return { ok: false, reason: "not_opted_in" };
  }
  if (g.replyOnlyMode && g.isColdOutbound) {
    // "Rispondi solo a chi ti scrive": l'outreach a freddo (campagne) resta
    // in coda finché il flag non viene disattivato esplicitamente dall'utente.
    return { ok: false, reason: "reply_only_mode", retryAfterMs: 15 * 60_000 };
  }
  if (g.sentToday >= g.dailyCap) {
    return { ok: false, reason: "daily_cap" };
  }
  if (g.sentThisHour >= g.hourlyCap) {
    return { ok: false, reason: "hourly_cap", retryAfterMs: 5 * 60_000 };
  }
  if (g.lastSendAt) {
    const elapsed = g.now.getTime() - g.lastSendAt.getTime();
    if (elapsed < g.minSpacingMs) {
      return { ok: false, reason: "spacing", retryAfterMs: g.minSpacingMs - elapsed };
    }
  }
  if (g.businessHoursOnlyOutbound && !g.withinHours) {
    return { ok: false, reason: "outside_hours", retryAfterMs: 15 * 60_000 };
  }
  return { ok: true };
}
