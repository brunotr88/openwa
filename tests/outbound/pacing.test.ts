import { describe, it, expect } from "vitest";
import { isJobDue, backoffDelayMs, evaluateSendEligibility } from "@/lib/outbound/pacing";
import type { SendGate } from "@/lib/outbound/types";

const base = (over: Partial<SendGate> = {}): SendGate => ({
  sessionStatus: "CONNECTED",
  optedIn: true,
  sentToday: 0,
  dailyCap: 1000,
  sentThisHour: 0,
  hourlyCap: 200,
  lastSendAt: null,
  minSpacingMs: 8000,
  now: new Date("2026-06-13T10:00:00Z"),
  businessHoursOnlyOutbound: true,
  withinHours: true,
  pauseOnRisk: true,
  ...over,
});

describe("isJobDue", () => {
  const now = new Date("2026-06-13T10:00:00Z");
  it("null scheduledAt è sempre dovuto", () => {
    expect(isJobDue(null, now)).toBe(true);
  });
  it("scheduledAt nel passato è dovuto", () => {
    expect(isJobDue(new Date("2026-06-13T09:59:00Z"), now)).toBe(true);
  });
  it("scheduledAt nel futuro non è dovuto", () => {
    expect(isJobDue(new Date("2026-06-13T10:01:00Z"), now)).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("cresce esponenzialmente e si ferma a 1h", () => {
    expect(backoffDelayMs(1)).toBe(60_000);
    expect(backoffDelayMs(2)).toBe(120_000);
    expect(backoffDelayMs(3)).toBe(240_000);
    expect(backoffDelayMs(20)).toBe(3_600_000);
  });
});

describe("evaluateSendEligibility", () => {
  it("ok quando tutto è a posto", () => {
    expect(evaluateSendEligibility(base()).ok).toBe(true);
  });
  it("blocca se la sessione è BANNED e pauseOnRisk attivo", () => {
    const d = evaluateSendEligibility(base({ sessionStatus: "BANNED" }));
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("session_banned");
  });
  it("blocca se non opted-in", () => {
    expect(evaluateSendEligibility(base({ optedIn: false }))).toMatchObject({
      ok: false,
      reason: "not_opted_in",
    });
  });
  it("blocca al raggiungimento del cap giornaliero", () => {
    expect(evaluateSendEligibility(base({ sentToday: 1000, dailyCap: 1000 }))).toMatchObject({
      ok: false,
      reason: "daily_cap",
    });
  });
  it("blocca al cap orario con retryAfter", () => {
    const d = evaluateSendEligibility(base({ sentThisHour: 200, hourlyCap: 200 }));
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("hourly_cap");
    expect(d.retryAfterMs).toBeGreaterThan(0);
  });
  it("blocca se sotto lo spacing minimo dall'ultimo invio", () => {
    const d = evaluateSendEligibility(
      base({ lastSendAt: new Date("2026-06-13T09:59:57Z"), minSpacingMs: 8000 })
    );
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("spacing");
    expect(d.retryAfterMs).toBe(5000);
  });
  it("blocca fuori orario se businessHoursOnlyOutbound", () => {
    expect(
      evaluateSendEligibility(base({ withinHours: false, businessHoursOnlyOutbound: true }))
    ).toMatchObject({ ok: false, reason: "outside_hours" });
  });
  it("consente fuori orario se businessHoursOnlyOutbound è off", () => {
    expect(
      evaluateSendEligibility(base({ withinHours: false, businessHoursOnlyOutbound: false })).ok
    ).toBe(true);
  });
});
