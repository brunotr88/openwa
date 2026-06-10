import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockSendText, mockGenerate, mockAuditLog } = vi.hoisted(() => ({
  mockDb: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    aiConfig: { findUnique: vi.fn() },
    message: { create: vi.fn(), update: vi.fn() },
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
    // newest-first, as returned by orderBy createdAt desc
    messages: [
      { direction: "IN", body: "Avete disponibilità?", status: "RECEIVED", createdAt: new Date() },
      { direction: "OUT", body: "Buongiorno!", status: "SENT", createdAt: new Date() },
    ],
  };
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerate.mockResolvedValue({
    text: "Sì, abbiamo disponibilità!",
    usage: { inputTokens: 10, outputTokens: 5 },
  });
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

  it("builds the prompt from tenant systemPrompt + contact profileSummary", async () => {
    await generateAndDeliverReply("conv1");
    const input = mockGenerate.mock.calls[0][0];
    expect(input.system).toContain("Sei l'assistente del negozio.");
    expect(input.system).toContain("Cliente abituale, preferisce risposte brevi.");
    // history oldest-first ending with the user message
    expect(input.messages[input.messages.length - 1]).toEqual({
      role: "user",
      content: "Avete disponibilità?",
    });
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

  it("falls back to DRAFT when tenant autoReplyEnabled is false", async () => {
    mockDb.aiConfig.findUnique.mockResolvedValue(
      aiConfigFixture({ autoReplyEnabled: false })
    );
    await generateAndDeliverReply("conv1");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT", aiGenerated: true }),
      })
    );
  });

  it("falls back to DRAFT outside business hours", async () => {
    // Sunday 2026-06-14 12:00 — days [1..5] excludes it
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 14, 12, 0, 0));
    mockDb.aiConfig.findUnique.mockResolvedValue(
      aiConfigFixture({
        businessHours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
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

  it("sends in AUTO inside business hours", async () => {
    // Wednesday 2026-06-10 10:30
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 10, 30, 0));
    mockDb.aiConfig.findUnique.mockResolvedValue(
      aiConfigFixture({
        businessHours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
      })
    );
    await generateAndDeliverReply("conv1");
    expect(mockSendText).toHaveBeenCalled();
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
    const conv = conversationFixture("AUTO");
    conv.messages = [
      { direction: "OUT", body: "Grazie!", status: "SENT", createdAt: new Date() },
    ];
    mockDb.conversation.findUnique.mockResolvedValue(conv);
    mockDb.aiConfig.findUnique.mockResolvedValue(aiConfigFixture());
    expect(await generateAndDeliverReply("conv1")).toBeNull();
  });
});

// ── isWithinBusinessHours ────────────────────────────────────────────────────

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
