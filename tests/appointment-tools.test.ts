import { describe, it, expect, vi } from "vitest";

import {
  appointmentSystemPrompt,
  buildAppointmentTools,
} from "../src/lib/appointments/tools";
import type { CalendarProvider } from "../src/lib/appointments/types";
import { MockCalendarProvider } from "../src/lib/appointments/mock";
import { parseTenantSettings } from "../src/lib/settings/merge";

const NOW = new Date("2026-06-15T08:00:00.000Z"); // lunedì

function settingsFixture(appointments: Record<string, unknown> = {}) {
  return parseTenantSettings({
    appointments: {
      provider: "google_calendar",
      googleCalendarId: "cal@group.calendar.google.com",
      ...appointments,
    },
  });
}

function fakeCalendar(overrides: Partial<CalendarProvider> = {}): CalendarProvider {
  return {
    listFreeSlots: vi.fn().mockResolvedValue([
      {
        start: new Date("2026-06-16T07:00:00.000Z"),
        end: new Date("2026-06-16T07:30:00.000Z"),
      },
    ]),
    createAppointment: vi
      .fn()
      .mockResolvedValue({ eventId: "ev1", htmlLink: "https://cal/ev1" }),
    ...overrides,
  };
}

describe("buildAppointmentTools — check_availability", () => {
  it("clamps the window (min notice + horizon) and formats slots it-IT", async () => {
    const calendar = fakeCalendar();
    const { executors } = buildAppointmentTools({
      settings: settingsFixture({ minNoticeHours: 12, maxDaysAhead: 14 }),
      calendar,
      allowBooking: true,
      now: () => NOW,
    });

    const out = (await executors.check_availability({})) as {
      slots: Array<{ datetime: string; label: string }>;
      timezone: string;
    };

    const call = (calendar.listFreeSlots as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.from.toISOString()).toBe("2026-06-15T20:00:00.000Z"); // +12h
    expect(call.to.toISOString()).toBe("2026-06-29T08:00:00.000Z"); // +14gg
    expect(call.durationMin).toBe(30);
    expect(call.bufferMin).toBe(15);

    expect(out.timezone).toBe("Europe/Rome");
    expect(out.slots[0].datetime).toBe("2026-06-16T07:00:00.000Z");
    expect(out.slots[0].label).toContain("09:00"); // 07:00Z = 09:00 Roma (CEST)
  });

  it("returns an explanatory message when the requested date violates the notice", async () => {
    const { executors } = buildAppointmentTools({
      settings: settingsFixture({ minNoticeHours: 48 }),
      calendar: fakeCalendar(),
      allowBooking: true,
      now: () => NOW,
    });
    const out = (await executors.check_availability({ date: "2026-06-15" })) as {
      slots: unknown[];
      message?: string;
    };
    expect(out.slots).toHaveLength(0);
    expect(out.message).toContain("48 ore");
  });
});

describe("buildAppointmentTools — book_appointment", () => {
  it("creates the event with title 'WhatsApp: {name} — {service}' and phone", async () => {
    const calendar = fakeCalendar();
    const onBooked = vi.fn();
    const { executors } = buildAppointmentTools({
      settings: settingsFixture(),
      calendar,
      allowBooking: true,
      contact: { name: "Mario", phone: "393331234567" },
      onBooked,
      now: () => NOW,
    });

    const out = (await executors.book_appointment({
      datetime: "2026-06-16T09:00:00+02:00",
      name: "Mario Rossi",
      service: "Taglio",
    })) as { ok: boolean; eventId: string };

    expect(out.ok).toBe(true);
    expect(out.eventId).toBe("ev1");
    const call = (calendar.createAppointment as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.title).toBe("WhatsApp: Mario Rossi — Taglio");
    expect(call.contactPhone).toBe("393331234567");
    expect(call.end.getTime() - call.start.getTime()).toBe(30 * 60_000);
    expect(onBooked).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "ev1", title: "WhatsApp: Mario Rossi — Taglio" })
    );
  });

  it("does NOT create real events when allowBooking=false (draft/COPILOT)", async () => {
    const calendar = fakeCalendar();
    const { executors } = buildAppointmentTools({
      settings: settingsFixture(),
      calendar,
      allowBooking: false,
      now: () => NOW,
    });
    const out = (await executors.book_appointment({
      datetime: "2026-06-16T09:00:00+02:00",
      name: "Mario",
    })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("operatore");
    expect(calendar.createAppointment).not.toHaveBeenCalled();
  });

  it("rejects missing name or invalid datetime", async () => {
    const calendar = fakeCalendar();
    const { executors } = buildAppointmentTools({
      settings: settingsFixture(),
      calendar,
      allowBooking: true,
      now: () => NOW,
    });
    expect(
      ((await executors.book_appointment({ datetime: "boh", name: "Mario" })) as {
        ok: boolean;
      }).ok
    ).toBe(false);
    expect(
      ((await executors.book_appointment({
        datetime: "2026-06-16T09:00:00+02:00",
        name: "  ",
      })) as { ok: boolean }).ok
    ).toBe(false);
    expect(calendar.createAppointment).not.toHaveBeenCalled();
  });

  it("bookingMode shapes the tool description (proponi vs prenota_diretto)", () => {
    const proponi = buildAppointmentTools({
      settings: settingsFixture({ bookingMode: "proponi" }),
      calendar: fakeCalendar(),
      allowBooking: true,
    });
    const diretto = buildAppointmentTools({
      settings: settingsFixture({ bookingMode: "prenota_diretto" }),
      calendar: fakeCalendar(),
      allowBooking: true,
    });
    const desc = (t: { tools: Array<{ name: string; description: string }> }) =>
      t.tools.find((x) => x.name === "book_appointment")!.description;
    expect(desc(proponi)).toContain("SOLO dopo che il cliente ha confermato esplicitamente");
    expect(desc(diretto)).toContain("appena il cliente sceglie");
  });

  it("simulated=true labels tool descriptions as simulation (playground)", () => {
    const { tools } = buildAppointmentTools({
      settings: settingsFixture(),
      calendar: new MockCalendarProvider(),
      allowBooking: true,
      simulated: true,
    });
    for (const t of tools) {
      expect(t.description).toContain("SIMULATI");
    }
  });
});

describe("appointmentSystemPrompt", () => {
  it("returns null when provider is nessuno", () => {
    expect(
      appointmentSystemPrompt(parseTenantSettings({ appointments: { provider: "nessuno" } }))
    ).toBeNull();
  });

  it("calendly_link → share-the-link instruction", () => {
    const p = appointmentSystemPrompt(
      parseTenantSettings({
        appointments: {
          provider: "calendly_link",
          calendlyUrl: "https://calendly.com/mario/30min",
        },
      })
    );
    expect(p).toContain("condividi questo link: https://calendly.com/mario/30min");
  });

  it("calendly_link without URL → null (not configured)", () => {
    expect(
      appointmentSystemPrompt(
        parseTenantSettings({ appointments: { provider: "calendly_link" } })
      )
    ).toBeNull();
  });

  it("google_calendar → tool instructions with max 2-3 slots + confirmation", () => {
    const p = appointmentSystemPrompt(settingsFixture({ bookingMode: "proponi" }));
    expect(p).toContain("2-3 slot");
    expect(p).toContain("check_availability");
    expect(p).toContain("SOLO dopo che il cliente ha confermato");
  });
});

describe("MockCalendarProvider", () => {
  it("returns synthetic slots and fake bookings (no network)", async () => {
    const mock = new MockCalendarProvider();
    const settings = settingsFixture();
    const slots = await mock.listFreeSlots({
      from: new Date("2026-06-16T00:00:00.000Z"),
      to: new Date("2026-06-17T00:00:00.000Z"),
      durationMin: 30,
      workingHours: settings.hours,
    });
    expect(slots.length).toBeGreaterThan(0);
    const res = await mock.createAppointment({
      start: new Date(),
      end: new Date(Date.now() + 1800_000),
      title: "WhatsApp: Test",
    });
    expect(res.eventId).toMatch(/^mock-/);
  });
});
