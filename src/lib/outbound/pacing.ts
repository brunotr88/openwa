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

export function evaluateSendEligibility(g: SendGate): SendDecision {
  if (g.pauseOnRisk && g.sessionStatus === "BANNED") {
    return { ok: false, reason: "session_banned" };
  }
  if (g.sessionStatus !== "CONNECTED") {
    return { ok: false, reason: "session_offline", retryAfterMs: 60_000 };
  }
  if (!g.optedIn) {
    return { ok: false, reason: "not_opted_in" };
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
