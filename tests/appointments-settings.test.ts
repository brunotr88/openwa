import { describe, it, expect } from "vitest";

import {
  appointmentsSchema,
  tenantSettingsSchema,
} from "../src/lib/settings/schema";
import { recommendedDefaults } from "../src/lib/settings/defaults";
import { parseTenantSettings } from "../src/lib/settings/merge";

describe("appointments settings — defaults", () => {
  it("recommendedDefaults include the appointments section with spec defaults", () => {
    const a = recommendedDefaults.appointments;
    expect(a.provider).toBe("nessuno");
    expect(a.calendlyUrl).toBe("");
    expect(a.googleCalendarId).toBe("");
    expect(a.slotDurationMin).toBe(30);
    expect(a.bufferMin).toBe(15);
    expect(a.minNoticeHours).toBe(12);
    expect(a.maxDaysAhead).toBe(14);
    expect(a.bookingMode).toBe("proponi");
    expect(a.confirmationMessage).toBe(true);
  });

  it("an empty object parses to full defaults", () => {
    const a = appointmentsSchema.parse({});
    expect(a.provider).toBe("nessuno");
    expect(a.slotDurationMin).toBe(30);
    expect(a.bookingMode).toBe("proponi");
  });

  it("stored settings WITHOUT appointments (pre-M5) still parse", () => {
    const s = parseTenantSettings({ persona: { botName: "Luca" } });
    expect(s.appointments.provider).toBe("nessuno");
    expect(s.persona.botName).toBe("Luca");
  });
});

describe("appointments settings — validation", () => {
  it("accepts a full google_calendar configuration", () => {
    const a = appointmentsSchema.parse({
      provider: "google_calendar",
      googleCalendarId: "abc123@group.calendar.google.com",
      slotDurationMin: 45,
      bufferMin: 10,
      minNoticeHours: 24,
      maxDaysAhead: 30,
      bookingMode: "prenota_diretto",
    });
    expect(a.provider).toBe("google_calendar");
    expect(a.slotDurationMin).toBe(45);
    expect(a.bookingMode).toBe("prenota_diretto");
  });

  it("accepts a valid https Calendly URL and the empty string", () => {
    expect(
      appointmentsSchema.parse({ calendlyUrl: "https://calendly.com/mario/30min" })
        .calendlyUrl
    ).toBe("https://calendly.com/mario/30min");
    expect(appointmentsSchema.parse({ calendlyUrl: "" }).calendlyUrl).toBe("");
  });

  it("rejects non-https Calendly URLs", () => {
    expect(
      appointmentsSchema.safeParse({ calendlyUrl: "http://calendly.com/x" }).success
    ).toBe(false);
    expect(appointmentsSchema.safeParse({ calendlyUrl: "non-un-url" }).success).toBe(
      false
    );
  });

  it("rejects unknown providers and bookingModes", () => {
    expect(appointmentsSchema.safeParse({ provider: "outlook" }).success).toBe(false);
    expect(appointmentsSchema.safeParse({ bookingMode: "subito" }).success).toBe(
      false
    );
  });

  it("enforces numeric ranges", () => {
    expect(appointmentsSchema.safeParse({ slotDurationMin: 0 }).success).toBe(false);
    expect(appointmentsSchema.safeParse({ slotDurationMin: 481 }).success).toBe(false);
    expect(appointmentsSchema.safeParse({ bufferMin: -1 }).success).toBe(false);
    expect(appointmentsSchema.safeParse({ minNoticeHours: 200 }).success).toBe(false);
    expect(appointmentsSchema.safeParse({ maxDaysAhead: 0 }).success).toBe(false);
    expect(appointmentsSchema.safeParse({ maxDaysAhead: 91 }).success).toBe(false);
    expect(appointmentsSchema.safeParse({ slotDurationMin: 30.5 }).success).toBe(
      false
    );
  });

  it("root schema round-trips an appointments patch", () => {
    const s = tenantSettingsSchema.parse({
      appointments: { provider: "calendly_link", calendlyUrl: "https://calendly.com/x" },
    });
    expect(s.appointments.provider).toBe("calendly_link");
    // altre sezioni intatte
    expect(s.behavior.aiMode).toBe("COPILOT");
  });
});
