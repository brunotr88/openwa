import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../src/lib/db", () => ({ db: mockDb }));

import {
  parseTenantSettings,
  getTenantSettings,
  saveTenantSettings,
  applyPreset,
  applySendProfile,
  buildSystemPrompt,
  matchEscalationKeyword,
  isWithinSchedule,
  autoSendAllowedNow,
  styleTemperature,
  lengthMaxTokens,
  recommendedDefaults,
  SEND_PROFILES,
  BUSINESS_PRESETS,
  getPreset,
  DEFAULT_ESCALATION_KEYWORDS,
} from "../src/lib/settings";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.tenant.update.mockResolvedValue({});
});

// ── Defaults & merge ─────────────────────────────────────────────────────────

describe("recommendedDefaults / parseTenantSettings", () => {
  it("recommendedDefaults match the research tables", () => {
    expect(recommendedDefaults.behavior.aiMode).toBe("COPILOT");
    expect(recommendedDefaults.behavior.responseStyle).toBe("preciso");
    expect(recommendedDefaults.behavior.maxResponseLength).toBe("breve");
    expect(recommendedDefaults.behavior.maxAiTurns).toBe(8);
    expect(recommendedDefaults.behavior.historyMessages).toBe(20);
    expect(recommendedDefaults.behavior.escalateOnHumanRequest).toBe(true);
    expect(recommendedDefaults.behavior.escalationKeywords).toContain("operatore");
    expect(recommendedDefaults.behavior.escalationKeywords).toContain("rimborso");
    expect(recommendedDefaults.sending.sendProfile).toBe("standard");
    expect(recommendedDefaults.sending.dailyCap).toBe(1000);
    expect(recommendedDefaults.sending.hourlyCap).toBe(200);
    expect(recommendedDefaults.sending.delayMinMs).toBe(3000);
    expect(recommendedDefaults.sending.delayMaxMs).toBe(8000);
    expect(recommendedDefaults.sending.replyOnlyMode).toBe(true);
    expect(recommendedDefaults.sending.groupAutoReply).toBe(false);
    expect(recommendedDefaults.hours.afterHoursMode).toBe("ai_sempre");
    expect(recommendedDefaults.hours.timezone).toBe("Europe/Rome");
    expect(recommendedDefaults.inbox.filterGroups).toBe("mostra_no_ai");
  });

  it("merges a partial stored JSON over the defaults", () => {
    const s = parseTenantSettings({
      persona: { botName: "Luca" },
      behavior: { aiMode: "AUTO" },
    });
    expect(s.persona.botName).toBe("Luca");
    expect(s.behavior.aiMode).toBe("AUTO");
    // untouched defaults survive
    expect(s.behavior.maxAiTurns).toBe(8);
    expect(s.sending.dailyCap).toBe(1000);
  });

  it("falls back to defaults on invalid stored JSON", () => {
    expect(parseTenantSettings("garbage")).toEqual(recommendedDefaults);
    expect(parseTenantSettings(null)).toEqual(recommendedDefaults);
    const s = parseTenantSettings({ behavior: { aiMode: "NOPE" } });
    expect(s.behavior.aiMode).toBe("COPILOT");
  });

  it("forces escalateOnHumanRequest to true even when stored as false", () => {
    const s = parseTenantSettings({ behavior: { escalateOnHumanRequest: false } });
    expect(s.behavior.escalateOnHumanRequest).toBe(true);
  });
});

describe("getTenantSettings / saveTenantSettings", () => {
  it("loads and merges Tenant.settings", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: { persona: { businessName: "Pizzeria Da Mario" } },
    });
    const s = await getTenantSettings("t1");
    expect(s.persona.businessName).toBe("Pizzeria Da Mario");
    expect(s.behavior.aiMode).toBe("COPILOT");
  });

  it("returns defaults when the tenant has no settings", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ settings: null });
    expect(await getTenantSettings("t1")).toEqual(recommendedDefaults);
  });

  it("persists the merged + validated settings", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ settings: null });
    const next = await saveTenantSettings("t1", {
      behavior: { aiMode: "AUTO", maxAiTurns: 10 },
    });
    expect(next.behavior.aiMode).toBe("AUTO");
    expect(next.behavior.maxAiTurns).toBe(10);
    expect(mockDb.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: { settings: expect.objectContaining({ behavior: expect.anything() }) },
      })
    );
  });

  it("rejects an invalid patch", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ settings: null });
    await expect(
      saveTenantSettings("t1", { behavior: { maxAiTurns: 999 } })
    ).rejects.toThrow();
  });
});

// ── Presets ──────────────────────────────────────────────────────────────────

describe("presets", () => {
  it("ships the 8 business presets from the research", () => {
    expect(BUSINESS_PRESETS.map((p) => p.id)).toEqual([
      "ristorante",
      "ecommerce",
      "studio_professionale",
      "bellezza",
      "immobiliare",
      "assistenza_it",
      "hotel",
      "palestra",
    ]);
    for (const p of BUSINESS_PRESETS) {
      expect(p.systemPrompt.length).toBeGreaterThan(200);
      expect(p.consigli).toHaveLength(3);
      expect(p.exampleQuestions.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("applyPreset sets persona + responseStyle overrides", () => {
    const s = applyPreset(recommendedDefaults, "studio_professionale");
    expect(s.persona.presetId).toBe("studio_professionale");
    expect(s.persona.tone).toBe("formale");
    expect(s.persona.formality).toBe("lei");
    expect(s.persona.emojiUsage).toBe("nessuna");
    expect(s.behavior.responseStyle).toBe("preciso");
    // aiMode untouched: activating the bot is an explicit step
    expect(s.behavior.aiMode).toBe(recommendedDefaults.behavior.aiMode);
  });

  it("applyPreset is a no-op for unknown ids", () => {
    expect(applyPreset(recommendedDefaults, "boh")).toEqual(recommendedDefaults);
  });

  it("getPreset finds presets by id", () => {
    expect(getPreset("hotel")?.label).toBe("Hotel & B&B");
    expect(getPreset(null)).toBeNull();
  });
});

// ── buildSystemPrompt ────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  function settingsWithPreset() {
    let s = applyPreset(recommendedDefaults, "ristorante");
    s = {
      ...s,
      persona: {
        ...s.persona,
        botName: "Gino",
        businessName: "Pizzeria Da Mario",
        city: "Bologna",
        businessDescription: "Pizzeria napoletana, forno a legna.",
      },
      behavior: {
        ...s.behavior,
        doRules: ["Proponi sempre l'asporto"],
        dontRules: ["Non confermare tavoli oltre 10 persone"],
        forbiddenTopics: ["politica"],
        customInstructions: "Il martedì siamo chiusi.",
      },
    };
    return s;
  }

  it("resolves preset {{placeholders}} with businessName and city", () => {
    const prompt = buildSystemPrompt(settingsWithPreset());
    expect(prompt).toContain("Sei l'assistente WhatsApp di Pizzeria Da Mario, ristorante/pizzeria a Bologna.");
    expect(prompt).not.toContain("{{");
  });

  it("drops the city clause gracefully when city is empty", () => {
    const s = settingsWithPreset();
    s.persona.city = "";
    const prompt = buildSystemPrompt(s);
    expect(prompt).toContain("ristorante/pizzeria.");
    expect(prompt).not.toContain("{{");
  });

  it("composes rules, forbidden topics, guardrails, disclosure and custom instructions", () => {
    const prompt = buildSystemPrompt(settingsWithPreset(), "Cliente abituale.");
    expect(prompt).toContain("Ti chiami Gino.");
    expect(prompt).toContain("Pizzeria napoletana, forno a legna.");
    expect(prompt).toContain("Cose da fare sempre:\n- Proponi sempre l'asporto");
    expect(prompt).toContain("Cose da non fare mai:\n- Non confermare tavoli oltre 10 persone");
    expect(prompt).toContain("Argomenti vietati");
    expect(prompt).toContain("politica");
    expect(prompt).toContain("Guardrail prezzi");
    expect(prompt).toContain("assistente virtuale (AI)");
    expect(prompt).toContain("Istruzioni aggiuntive:\nIl martedì siamo chiusi.");
    expect(prompt).toContain("Note sul contatto:\nCliente abituale.");
    expect(prompt).toContain("un operatore lo ricontatterà");
  });

  it("omits optional blocks when their toggles are off / lists empty", () => {
    const s = parseTenantSettings({
      behavior: {
        aiDisclosure: false,
        priceGuardrail: false,
        escalateOnUncertainty: false,
        forbiddenTopics: [],
      },
    });
    const prompt = buildSystemPrompt(s);
    expect(prompt).not.toContain("assistente virtuale (AI)");
    expect(prompt).not.toContain("Guardrail prezzi");
    expect(prompt).not.toContain("Cose da fare sempre");
    expect(prompt).not.toContain("Argomenti vietati");
  });

  it("adds the after-hours disclaimer only when outside business hours", () => {
    const s = settingsWithPreset();
    const inHours = buildSystemPrompt(s, { outsideBusinessHours: false });
    const outHours = buildSystemPrompt(s, { outsideBusinessHours: true });
    expect(inHours).not.toContain("fuori orario di attività");
    expect(outHours).toContain("fuori orario di attività");
    // disclaimer disattivato → mai aggiunto
    const noDisc = { ...s, hours: { ...s.hours, afterHoursDisclaimer: false } };
    expect(buildSystemPrompt(noDisc, { outsideBusinessHours: true })).not.toContain(
      "fuori orario di attività"
    );
  });

  it("uses a generic identity without a preset", () => {
    const s = parseTenantSettings({ persona: { businessName: "ACME" } });
    const prompt = buildSystemPrompt(s);
    expect(prompt).toContain("Sei l'assistente WhatsApp di ACME.");
  });
});

// ── Send profiles & mappings ─────────────────────────────────────────────────

describe("send profiles", () => {
  it("maps the whatsapp-ops limits", () => {
    expect(SEND_PROFILES.standard).toEqual({
      dailyCap: 1000,
      hourlyCap: 200,
      delayMinMs: 3000,
      delayMaxMs: 8000,
    });
    expect(SEND_PROFILES.prudente.dailyCap).toBeLessThan(SEND_PROFILES.standard.dailyCap);
    expect(SEND_PROFILES.aggressivo.dailyCap).toBeGreaterThan(SEND_PROFILES.standard.dailyCap);
    expect(SEND_PROFILES.prudente.delayMinMs).toBeGreaterThanOrEqual(2000);
  });

  it("applySendProfile copies the profile values", () => {
    const sending = applySendProfile(recommendedDefaults.sending, "prudente");
    expect(sending.sendProfile).toBe("prudente");
    expect(sending.dailyCap).toBe(200);
    expect(sending.hourlyCap).toBe(30);
  });

  it("applySendProfile keeps custom values for personalizzato", () => {
    const custom = { ...recommendedDefaults.sending, dailyCap: 123 };
    const sending = applySendProfile(custom, "personalizzato");
    expect(sending.sendProfile).toBe("personalizzato");
    expect(sending.dailyCap).toBe(123);
  });

  it("styleTemperature / lengthMaxTokens map the segmented values", () => {
    expect(styleTemperature("preciso")).toBe(0.2);
    expect(styleTemperature("bilanciato")).toBe(0.4);
    expect(styleTemperature("creativo")).toBe(0.7);
    expect(lengthMaxTokens("breve")).toBe(256);
    expect(lengthMaxTokens("lunga")).toBe(1024);
  });
});

// ── Escalation keywords ──────────────────────────────────────────────────────

describe("matchEscalationKeyword", () => {
  it("matches case-insensitive substrings", () => {
    expect(
      matchEscalationKeyword("Voglio un RIMBORSO immediato", DEFAULT_ESCALATION_KEYWORDS)
    ).toBe("rimborso");
    expect(
      matchEscalationKeyword("posso parlare con un operatore?", DEFAULT_ESCALATION_KEYWORDS)
    ).toBe("operatore");
  });

  it("returns null when nothing matches", () => {
    expect(matchEscalationKeyword("che orari fate?", DEFAULT_ESCALATION_KEYWORDS)).toBeNull();
    expect(matchEscalationKeyword(null, DEFAULT_ESCALATION_KEYWORDS)).toBeNull();
  });
});

// ── Schedule / afterHoursMode ────────────────────────────────────────────────

describe("isWithinSchedule / autoSendAllowedNow", () => {
  const hours = {
    ...recommendedDefaults.hours,
    timezone: "UTC",
  };

  // Wed 2026-06-10 10:00 UTC / Sun 2026-06-14
  const wedMorning = new Date(Date.UTC(2026, 5, 10, 10, 0));
  const wedNight = new Date(Date.UTC(2026, 5, 10, 22, 0));
  const sunday = new Date(Date.UTC(2026, 5, 14, 10, 0));

  it("checks the per-day schedule", () => {
    expect(isWithinSchedule(hours, wedMorning)).toBe(true);
    expect(isWithinSchedule(hours, wedNight)).toBe(false);
    expect(isWithinSchedule(hours, sunday)).toBe(false); // domenica disabilitata
  });

  it("handles overnight windows that wrap past midnight", () => {
    const schedule = { ...hours.schedule };
    // Wed (day 3): finestra 20:00 → 02:00 (attraversa la mezzanotte)
    schedule[3] = { enabled: true, start: "20:00", end: "02:00" };
    const overnight = { ...hours, schedule };
    // 22:00 rientra nella finestra serale
    expect(isWithinSchedule(overnight, wedNight)).toBe(true);
    // 10:00 è fuori (mattina)
    expect(isWithinSchedule(overnight, wedMorning)).toBe(false);
    // 01:00 di mercoledì rientra (coda notturna)
    expect(isWithinSchedule(overnight, new Date(Date.UTC(2026, 5, 10, 1, 0)))).toBe(true);
  });

  it("ai_sempre always allows auto-send", () => {
    expect(autoSendAllowedNow({ ...hours, afterHoursMode: "ai_sempre" }, wedNight)).toBe(true);
    expect(autoSendAllowedNow({ ...hours, afterHoursMode: "ai_sempre" }, wedMorning)).toBe(true);
  });

  it("ai_fuori_orario allows auto-send only outside business hours", () => {
    const h = { ...hours, afterHoursMode: "ai_fuori_orario" as const };
    expect(autoSendAllowedNow(h, wedMorning)).toBe(false);
    expect(autoSendAllowedNow(h, wedNight)).toBe(true);
    expect(autoSendAllowedNow(h, sunday)).toBe(true);
  });

  it("solo_assenza never allows auto-send", () => {
    const h = { ...hours, afterHoursMode: "solo_assenza" as const };
    expect(autoSendAllowedNow(h, wedMorning)).toBe(false);
    expect(autoSendAllowedNow(h, wedNight)).toBe(false);
  });
});
