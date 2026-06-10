import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockSendText, mockGenerate, mockAuditLog } = vi.hoisted(() => ({
  mockDb: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    aiConfig: { findUnique: vi.fn() },
    message: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    tenant: { findUnique: vi.fn(), update: vi.fn() },
  },
  mockSendText: vi.fn(),
  mockGenerate: vi.fn(),
  mockAuditLog: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({ db: mockDb }));
vi.mock("../src/lib/audit", () => ({ auditLog: mockAuditLog }));
vi.mock("../src/lib/wa/gateway-client", () => ({
  sendText: mockSendText,
}));
vi.mock("../src/lib/ai", () => ({
  getProvider: () => ({ generate: mockGenerate }),
}));

import { generateAndDeliverReply, isWithinBusinessHours } from "../src/lib/wa/reply";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function conversationFixture(mode: "AUTO" | "COPILOT" | "MANUAL") {
  return {
    id: "conv1",
    tenantId: "t1",
    sessionId: "wa1",
    mode,
    contact: {
      id: "c1",
      waId: "393331234567",
      name: "Mario Rossi",
      profileSummary: "Cliente abituale, preferisce risposte brevi.",
    },
    session: { id: "wa1", sessionDataRef: "gw-uuid" },
  };
}

// newest-first, as returned by orderBy createdAt desc
function historyFixture() {
  return [
    {
      direction: "IN",
      body: "Avete disponibilità?",
      status: "RECEIVED",
      aiGenerated: false,
      createdAt: new Date(),
    },
    {
      direction: "OUT",
      body: "Buongiorno!",
      status: "SENT",
      aiGenerated: false,
      createdAt: new Date(),
    },
  ];
}

function aiConfigFixture(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "t1",
    provider: "BEDROCK",
    modelId: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
    systemPrompt: "Sei l'assistente del negozio.",
    temperature: 0.5,
    autoReplyEnabled: true,
    businessHours: null,
    ...overrides,
  };
}

/** Tenant settings: bot attivo in AUTO, niente delay nei test. */
function tenantSettingsFixture(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      persona: { businessName: "Il Negozio" },
      behavior: { aiMode: "AUTO" },
      sending: { randomDelay: false },
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerate.mockResolvedValue({
    text: "Sì, abbiamo disponibilità!",
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  mockDb.tenant.findUnique.mockResolvedValue(tenantSettingsFixture());
  mockDb.message.findMany.mockResolvedValue(historyFixture());
  mockDb.message.count.mockResolvedValue(0);
  mockDb.message.create.mockResolvedValue({ id: "out1" });
  mockDb.message.update.mockResolvedValue({});
  mockDb.conversation.update.mockResolvedValue({});
  mockSendText.mockResolvedValue({ messageId: "wamid1", timestamp: 1780000000 });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── AUTO mode ────────────────────────────────────────────────────────────────

describe("generateAndDeliverReply — AUTO", () => {
  beforeEach(() => {
    mockDb.conversation.findUnique.mockResolvedValue(conversationFixture("AUTO"));
    mockDb.aiConfig.findUnique.mockResolvedValue(aiConfigFixture());
  });

  it("creates Message(OUT, QUEUED, aiGenerated), sends via gateway, marks SENT", async () => {
    const id = await generateAndDeliverReply("conv1");
    expect(id).toBe("out1");

    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "OUT",
          status: "QUEUED",
          aiGenerated: true,
          body: "Sì, abbiamo disponibilità!",
        }),
      })
    );
    expect(mockSendText).toHaveBeenCalledWith(
      "gw-uuid",
      "393331234567",
      "Sì, abbiamo disponibilità!"
    );
    expect(mockDb.message.update).toHaveBeenCalledWith({
      where: { id: "out1" },
      data: { status: "SENT" },
    });
    // audit-logged
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai.reply.sent", entityId: "out1" })
    );
  });

  it("builds the prompt from tenant settings + contact profileSummary", async () => {
    await generateAndDeliverReply("conv1");
    const input = mockGenerate.mock.calls[0][0];
    expect(input.system).toContain("Il Negozio");
    expect(input.system).toContain("Cliente abituale, preferisce risposte brevi.");
    expect(input.system).toContain("Stai parlando con: Mario Rossi.");
    // history oldest-first ending with the user message
    expect(input.messages[input.messages.length - 1]).toEqual({
      role: "user",
      content: "Avete disponibilità?",
    });
  });

  it("uses responseStyle temperature and maxResponseLength maxTokens", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({
        behavior: {
          aiMode: "AUTO",
          responseStyle: "creativo",
          maxResponseLength: "lunga",
        },
      })
    );
    await generateAndDeliverReply("conv1");
    const input = mockGenerate.mock.calls[0][0];
    expect(input.temperature).toBe(0.7);
    expect(input.maxTokens).toBe(1024);
  });

  it("respects the historyMessages window", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({
        behavior: { aiMode: "AUTO", historyMessages: 5 },
      })
    );
    await generateAndDeliverReply("conv1");
    expect(mockDb.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
  });

  it("marks the message FAILED when the gateway send throws", async () => {
    mockSendText.mockRejectedValue(new Error("gateway down"));
    await generateAndDeliverReply("conv1");
    expect(mockDb.message.update).toHaveBeenCalledWith({
      where: { id: "out1" },
      data: { status: "FAILED" },
    });
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai.reply.failed" })
    );
  });

  it("falls back to DRAFT when tenant aiMode is COPILOT", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({ behavior: { aiMode: "COPILOT" } })
    );
    await generateAndDeliverReply("conv1");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT", aiGenerated: true }),
      })
    );
  });

  it("does nothing when tenant aiMode is OFF", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({ behavior: { aiMode: "OFF" } })
    );
    const id = await generateAndDeliverReply("conv1");
    expect(id).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockDb.message.create).not.toHaveBeenCalled();
  });

  it("drafts during business hours when afterHoursMode is ai_fuori_orario", async () => {
    // Wednesday 2026-06-10 10:30 UTC — inside default Mon-Fri 09-19 schedule
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 10, 10, 30, 0)));
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({
        behavior: { aiMode: "AUTO" },
        hours: { afterHoursMode: "ai_fuori_orario", timezone: "UTC" },
      })
    );
    await generateAndDeliverReply("conv1");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT" }),
      })
    );
  });

  it("sends outside business hours when afterHoursMode is ai_fuori_orario", async () => {
    // Wednesday 2026-06-10 22:00 UTC — outside default schedule
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 10, 22, 0, 0)));
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({
        behavior: { aiMode: "AUTO" },
        hours: { afterHoursMode: "ai_fuori_orario", timezone: "UTC" },
      })
    );
    await generateAndDeliverReply("conv1");
    expect(mockSendText).toHaveBeenCalled();
  });

  it("never auto-sends when afterHoursMode is solo_assenza", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({
        behavior: { aiMode: "AUTO" },
        hours: { afterHoursMode: "solo_assenza" },
      })
    );
    await generateAndDeliverReply("conv1");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT" }),
      })
    );
  });
});

// ── COPILOT / MANUAL ─────────────────────────────────────────────────────────

describe("generateAndDeliverReply — COPILOT", () => {
  it("creates a DRAFT only and never calls the gateway", async () => {
    mockDb.conversation.findUnique.mockResolvedValue(conversationFixture("COPILOT"));
    mockDb.aiConfig.findUnique.mockResolvedValue(aiConfigFixture());

    const id = await generateAndDeliverReply("conv1");
    expect(id).toBe("out1");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockDb.message.create).toHaveBeenCalledTimes(1);
    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "OUT",
          status: "DRAFT",
          aiGenerated: true,
          source: "WA",
        }),
      })
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai.reply.draft" })
    );
  });
});

describe("generateAndDeliverReply — MANUAL / edge cases", () => {
  it("does nothing in MANUAL mode", async () => {
    mockDb.conversation.findUnique.mockResolvedValue(conversationFixture("MANUAL"));
    const id = await generateAndDeliverReply("conv1");
    expect(id).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockDb.message.create).not.toHaveBeenCalled();
  });

  it("does nothing when the conversation does not exist", async () => {
    mockDb.conversation.findUnique.mockResolvedValue(null);
    expect(await generateAndDeliverReply("nope")).toBeNull();
  });

  it("does nothing when the tenant has no AiConfig", async () => {
    mockDb.conversation.findUnique.mockResolvedValue(conversationFixture("AUTO"));
    mockDb.aiConfig.findUnique.mockResolvedValue(null);
    expect(await generateAndDeliverReply("conv1")).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("does nothing when the last message is not from the user", async () => {
    mockDb.conversation.findUnique.mockResolvedValue(conversationFixture("AUTO"));
    mockDb.aiConfig.findUnique.mockResolvedValue(aiConfigFixture());
    mockDb.message.findMany.mockResolvedValue([
      {
        direction: "OUT",
        body: "Grazie!",
        status: "SENT",
        aiGenerated: false,
        createdAt: new Date(),
      },
    ]);
    expect(await generateAndDeliverReply("conv1")).toBeNull();
  });
});

// ── Appuntamenti (M5) ────────────────────────────────────────────────────────

describe("generateAndDeliverReply — appointments wiring", () => {
  beforeEach(() => {
    mockDb.conversation.findUnique.mockResolvedValue(conversationFixture("AUTO"));
    mockDb.aiConfig.findUnique.mockResolvedValue(aiConfigFixture());
  });

  it("calendly_link: appends the link instruction to the system prompt, no tools", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({
        appointments: {
          provider: "calendly_link",
          calendlyUrl: "https://calendly.com/negozio/30min",
        },
      })
    );
    await generateAndDeliverReply("conv1");
    const input = mockGenerate.mock.calls[0][0];
    expect(input.system).toContain(
      "condividi questo link: https://calendly.com/negozio/30min"
    );
    expect(input.tools).toBeUndefined();
  });

  it("google_calendar: runs the tool-loop with check_availability/book_appointment", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(
      tenantSettingsFixture({
        appointments: {
          provider: "google_calendar",
          googleCalendarId: "cal@group.calendar.google.com",
        },
      })
    );
    await generateAndDeliverReply("conv1");
    const input = mockGenerate.mock.calls[0][0];
    expect(input.system).toContain("Prenotazione appuntamenti");
    expect(input.tools?.map((t: { name: string }) => t.name)).toEqual([
      "check_availability",
      "book_appointment",
    ]);
    // tetto token alzato per le tool call
    expect(input.maxTokens).toBeGreaterThanOrEqual(600);
    // la risposta finale viene comunque inviata
    expect(mockSendText).toHaveBeenCalled();
  });

  it("provider nessuno (default): plain generate without tools", async () => {
    await generateAndDeliverReply("conv1");
    const input = mockGenerate.mock.calls[0][0];
    expect(input.tools).toBeUndefined();
    expect(input.system).not.toContain("Prenotazione appuntamenti");
  });
});

// ── isWithinBusinessHours (legacy AiConfig.businessHours) ────────────────────

describe("isWithinBusinessHours", () => {
  it("returns true when no business hours are configured", () => {
    expect(isWithinBusinessHours(null)).toBe(true);
    expect(isWithinBusinessHours(undefined)).toBe(true);
  });

  it("supports the { start, end, days } string shape", () => {
    const bh = { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] };
    expect(isWithinBusinessHours(bh, new Date(2026, 5, 10, 10, 0))).toBe(true); // Wed 10:00
    expect(isWithinBusinessHours(bh, new Date(2026, 5, 10, 20, 0))).toBe(false); // Wed 20:00
    expect(isWithinBusinessHours(bh, new Date(2026, 5, 14, 10, 0))).toBe(false); // Sun
  });

  it("supports the { startHour, endHour, days } numeric shape", () => {
    const bh = { startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] };
    expect(isWithinBusinessHours(bh, new Date(2026, 5, 10, 8, 59))).toBe(false);
    expect(isWithinBusinessHours(bh, new Date(2026, 5, 10, 9, 0))).toBe(true);
    expect(isWithinBusinessHours(bh, new Date(2026, 5, 10, 17, 59))).toBe(true);
    expect(isWithinBusinessHours(bh, new Date(2026, 5, 10, 18, 0))).toBe(false);
  });
});
