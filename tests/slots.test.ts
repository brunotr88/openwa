import { describe, it, expect } from "vitest";

import {
  clampBookingWindow,
  computeFreeSlots,
  formatSlotItalian,
  zonedToUtc,
} from "../src/lib/appointments/slots";
import type { HoursSettings } from "../src/lib/settings/schema";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const day = (enabled: boolean, start = "09:00", end = "18:00") => ({
  enabled,
  start,
  end,
});

/** Lun-ven 09-18, weekend chiuso, Europe/Rome. */
function hoursFixture(overrides: Partial<HoursSettings> = {}): HoursSettings {
  return {
    timezone: "Europe/Rome",
    schedule: [
      day(false), // dom
      day(true),
      day(true),
      day(true),
      day(true),
      day(true), // ven
      day(false), // sab
    ],
    afterHoursMode: "ai_sempre",
    afterHoursDisclaimer: true,
    ...overrides,
  };
}

// Lunedì 15 giugno 2026 (CEST = UTC+2).
const MON_9_ROME = new Date("2026-06-15T07:00:00.000Z");
const MON_18_ROME = new Date("2026-06-15T16:00:00.000Z");

// ── zonedToUtc ───────────────────────────────────────────────────────────────

describe("zonedToUtc", () => {
  it("converts Rome wall time to UTC (CEST, +2)", () => {
    expect(zonedToUtc(2026, 6, 15, 9, 0, "Europe/Rome").toISOString()).toBe(
      "2026-06-15T07:00:00.000Z"
    );
  });
  it("handles winter time (CET, +1)", () => {
    expect(zonedToUtc(2026, 1, 12, 9, 0, "Europe/Rome").toISOString()).toBe(
      "2026-01-12T08:00:00.000Z"
    );
  });
});

// ── clampBookingWindow ───────────────────────────────────────────────────────

describe("clampBookingWindow", () => {
  const now = new Date("2026-06-15T08:00:00.000Z");

  it("applies min notice and max days ahead", () => {
    const w = clampBookingWindow({ now, minNoticeHours: 12, maxDaysAhead: 14 });
    expect(w).not.toBeNull();
    expect(w!.start.toISOString()).toBe("2026-06-15T20:00:00.000Z");
    expect(w!.end.toISOString()).toBe("2026-06-29T08:00:00.000Z");
  });

  it("intersects a requested window", () => {
    const w = clampBookingWindow({
      now,
      minNoticeHours: 12,
      maxDaysAhead: 14,
      requestedFrom: new Date("2026-06-17T00:00:00.000Z"),
      requestedTo: new Date("2026-06-18T00:00:00.000Z"),
    });
    expect(w!.start.toISOString()).toBe("2026-06-17T00:00:00.000Z");
    expect(w!.end.toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });

  it("returns null when the requested day is before the min notice", () => {
    const w = clampBookingWindow({
      now,
      minNoticeHours: 48,
      maxDaysAhead: 14,
      requestedFrom: new Date("2026-06-15T08:00:00.000Z"),
      requestedTo: new Date("2026-06-16T08:00:00.000Z"),
    });
    expect(w).toBeNull();
  });

  it("returns null when the requested day is beyond the horizon", () => {
    const w = clampBookingWindow({
      now,
      minNoticeHours: 0,
      maxDaysAhead: 7,
      requestedFrom: new Date("2026-07-15T00:00:00.000Z"),
      requestedTo: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(w).toBeNull();
  });
});

// ── computeFreeSlots ─────────────────────────────────────────────────────────

describe("computeFreeSlots", () => {
  it("fills working hours with duration+buffer steps (free day)", () => {
    const slots = computeFreeSlots({
      from: MON_9_ROME,
      to: MON_18_ROME,
      durationMin: 60,
      bufferMin: 0,
      busy: [],
      workingHours: hoursFixture(),
    });
    // 09-18 → 9 slot da 60'
    expect(slots).toHaveLength(9);
    expect(slots[0].start.toISOString()).toBe("2026-06-15T07:00:00.000Z");
    expect(slots[0].end.toISOString()).toBe("2026-06-15T08:00:00.000Z");
    expect(slots[8].start.toISOString()).toBe("2026-06-15T15:00:00.000Z");
  });

  it("respects bufferMin between candidates", () => {
    const slots = computeFreeSlots({
      from: MON_9_ROME,
      to: MON_18_ROME,
      durationMin: 30,
      bufferMin: 15,
      busy: [],
      workingHours: hoursFixture(),
      maxSlots: 100,
    });
    // passo 45': 09:00, 09:45, 10:30, …
    expect(slots[0].start.toISOString()).toBe("2026-06-15T07:00:00.000Z");
    expect(slots[1].start.toISOString()).toBe("2026-06-15T07:45:00.000Z");
    expect(slots[2].start.toISOString()).toBe("2026-06-15T08:30:00.000Z");
  });

  it("skips slots overlapping busy intervals (buffer on both sides)", () => {
    const slots = computeFreeSlots({
      from: MON_9_ROME,
      to: MON_18_ROME,
      durationMin: 60,
      bufferMin: 15,
      // impegno 10:00-11:00 Roma = 08:00-09:00Z
      busy: [
        {
          start: new Date("2026-06-15T08:00:00.000Z"),
          end: new Date("2026-06-15T09:00:00.000Z"),
        },
      ],
      workingHours: hoursFixture(),
      maxSlots: 100,
    });
    // 09:00-10:00 Roma termina alle 10:00, ma col buffer 15' collide con l'impegno delle 10:00.
    const starts = slots.map((s) => s.start.toISOString());
    expect(starts).not.toContain("2026-06-15T07:00:00.000Z");
    expect(starts).not.toContain("2026-06-15T08:15:00.000Z");
    // il primo slot valido parte dopo impegno+buffer (>= 11:15 Roma = 09:15Z)
    expect(slots[0].start.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-06-15T09:15:00.000Z").getTime()
    );
  });

  it("returns no slots on disabled days (weekend)", () => {
    // sabato 20 giugno 2026
    const slots = computeFreeSlots({
      from: new Date("2026-06-20T00:00:00.000Z"),
      to: new Date("2026-06-21T00:00:00.000Z"),
      durationMin: 30,
      busy: [],
      workingHours: hoursFixture(),
    });
    expect(slots).toHaveLength(0);
  });

  it("clips slots to the requested window (min notice applied upstream)", () => {
    // finestra che inizia alle 15:00 Roma → niente slot mattutini
    const slots = computeFreeSlots({
      from: new Date("2026-06-15T13:00:00.000Z"),
      to: MON_18_ROME,
      durationMin: 60,
      busy: [],
      workingHours: hoursFixture(),
    });
    expect(slots[0].start.toISOString()).toBe("2026-06-15T13:00:00.000Z");
    expect(slots).toHaveLength(3); // 15, 16, 17 Roma
  });

  it("spans multiple days and honours per-day schedules", () => {
    const hours = hoursFixture();
    hours.schedule[2] = day(true, "10:00", "12:00"); // martedì corto
    const slots = computeFreeSlots({
      from: MON_9_ROME,
      to: new Date("2026-06-16T22:00:00.000Z"),
      durationMin: 60,
      busy: [],
      workingHours: hours,
      maxSlots: 100,
    });
    const tuesday = slots.filter((s) =>
      s.start.toISOString().startsWith("2026-06-16")
    );
    expect(tuesday).toHaveLength(2); // 10-11, 11-12 Roma
    expect(tuesday[0].start.toISOString()).toBe("2026-06-16T08:00:00.000Z");
  });

  it("caps the number of returned slots (maxSlots)", () => {
    const slots = computeFreeSlots({
      from: MON_9_ROME,
      to: new Date("2026-06-19T22:00:00.000Z"),
      durationMin: 30,
      busy: [],
      workingHours: hoursFixture(),
      maxSlots: 5,
    });
    expect(slots).toHaveLength(5);
  });

  it("returns [] for empty/invalid windows", () => {
    expect(
      computeFreeSlots({
        from: MON_18_ROME,
        to: MON_9_ROME,
        durationMin: 30,
        busy: [],
        workingHours: hoursFixture(),
      })
    ).toEqual([]);
  });
});

// ── formatSlotItalian ────────────────────────────────────────────────────────

describe("formatSlotItalian", () => {
  it("formats in Italian with the tenant timezone", () => {
    const label = formatSlotItalian(
      new Date("2026-06-15T07:00:00.000Z"),
      "Europe/Rome"
    );
    expect(label).toContain("luned");
    expect(label).toContain("15");
    expect(label).toContain("giugno");
    expect(label).toContain("09:00");
  });
});
