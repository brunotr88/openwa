import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockSendText, mockGenerate, mockAuditLog } = vi.hoisted(() => ({
  mockDb: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    aiConfig: { findUnique: vi.fn() },
    message: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    waSession: { findUnique: vi.fn() },
  },
  mockSendText: vi.fn(),
  mockGenerate: vi.fn(),
  mockAuditLog: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({ db: mockDb }));
vi.mock("../src/lib/audit", () => ({ auditLog: mockAuditLog }));
vi.mock("../src/lib/wa/gateway-client", () => ({
  sendText: mockSendText,
  contactChatId: (c: { phone: string | null; waId: string }) => {
    if (c.phone) return `${c.phone.replace(/^\+/, "")}@c.us`;
    if (c.waId.includes("@")) return c.waId;
    if (/^\d{6,13}$/.test(c.waId)) return `${c.waId}@c.us`;
    if (/^\d{14,}$/.test(c.waId)) return `${c.waId}@lid`;
    return null;
  },
}));
vi.mock("../src/lib/ai", () => ({
  getProvider: () => ({ generate: mockGenerate }),
}));

import {
  generateAndDeliverReply,
  countConsecutiveAiTurns,
} from "../src/lib/wa/reply";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const conversation = {
  id: "conv1",
  tenantId: "t1",
  sessionId: "wa1",
  mode: "AUTO",
  contact: { id: "c1", waId: "393331234567", name: null, profileSummary: null },
  session: { id: "wa1", sessionDataRef: "gw-uuid" },
};

function inbound(body: string) {
  return {
    direction: "IN",
    body,
    status: "RECEIVED",
    aiGenerated: false,
    createdAt: new Date(),
  };
}

function aiOutbound(body = "Risposta AI") {
  return {
    direction: "OUT",
    body,
    status: "SENT",
    aiGenerated: true,
    createdAt: new Date(),
  };
}

function humanOutbound(body = "Risposta umana") {
  return {
    direction: "OUT",
    body,
    status: "SENT",
    aiGenerated: false,
    createdAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerate.mockResolvedValue({
    text: "Capisco, la metto in contatto con un operatore.",
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  mockDb.conversation.findUnique.mockResolvedValue(conversation);
  mockDb.conversation.update.mockResolvedValue({});
  mockDb.aiConfig.findUnique.mockResolvedValue({
    tenantId: "t1",
    provider: "BEDROCK",
    modelId: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  });
  // Bot pienamente attivo: aiMode AUTO, AI 24/7, no delay nei test.
  mockDb.tenant.findUnique.mockResolvedValue({
    settings: {
      behavior: { aiMode: "AUTO" },
      hours: { afterHoursMode: "ai_sempre" },
      sending: { randomDelay: false },
    },
  });
  // getSessionSettings legge waSession.findUnique e ripiega su tenant.settings
  // quando il numero non ha override: deleghiamo al mock tenant esistente così
  // tutti gli override `tenant.findUnique` dei singoli test restano validi.
  mockDb.waSession.findUnique.mockImplementation(async () => ({
    settings: null,
    tenant: await mockDb.tenant.findUnique(),
  }));
  mockDb.message.findMany.mockResolvedValue([inbound("Che orari fate?")]);
  mockDb.message.count.mockResolvedValue(0);
  mockDb.message.create.mockResolvedValue({ id: "out1" });
  mockDb.message.update.mockResolvedValue({});
  mockSendText.mockResolvedValue({ messageId: "wamid1", timestamp: 1780000000 });
});

// ── Keyword escalation ───────────────────────────────────────────────────────

describe("escalation — keyword match forces DRAFT", () => {
  it.each(["rimborso", "operatore", "avvocato", "reclamo"])(
    "inbound containing %s → DRAFT (no auto-send) + audit",
    async (kw) => {
      mockDb.message.findMany.mockResolvedValue([
        inbound(`Voglio un ${kw} adesso`),
      ]);
      const id = await generateAndDeliverReply("conv1");
      expect(id).toBe("out1");
      expect(mockSendText).not.toHaveBeenCalled();
      expect(mockDb.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "DRAFT", aiGenerated: true }),
        })
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ai.escalation.keyword",
          meta: expect.objectContaining({ keyword: kw }),
        })
      );
    }
  );

  it("matches case-insensitively", async () => {
    mockDb.message.findMany.mockResolvedValue([inbound("VOGLIO IL RIMBORSO!!!")]);
    await generateAndDeliverReply("conv1");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai.escalation.keyword" })
    );
  });

  it("custom tenant keywords are honoured", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: {
        behavior: { aiMode: "AUTO", escalationKeywords: ["glutine"] },
        sending: { randomDelay: false },
      },
    });
    mockDb.message.findMany.mockResolvedValue([
      inbound("Mio figlio è allergico al glutine"),
    ]);
    await generateAndDeliverReply("conv1");
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it("sends normally when no keyword matches", async () => {
    mockDb.message.findMany.mockResolvedValue([inbound("Che orari fate?")]);
    await generateAndDeliverReply("conv1");
    expect(mockSendText).toHaveBeenCalled();
  });
});

// ── maxAiTurns ───────────────────────────────────────────────────────────────

describe("escalation — maxAiTurns forces DRAFT", () => {
  it("counts consecutive AI replies without a human", () => {
    expect(countConsecutiveAiTurns([])).toBe(0);
    expect(
      countConsecutiveAiTurns([
        inbound("x"),
        aiOutbound(),
        aiOutbound(),
        inbound("y"),
        aiOutbound(),
      ])
    ).toBe(3);
    // un OUT umano azzera il conteggio
    expect(
      countConsecutiveAiTurns([aiOutbound(), humanOutbound(), aiOutbound()])
    ).toBe(1);
  });

  it("forces DRAFT after maxAiTurns consecutive AI replies", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: {
        behavior: { aiMode: "AUTO", maxAiTurns: 3 },
        sending: { randomDelay: false },
      },
    });
    mockDb.message.findMany.mockResolvedValue([
      inbound("e quindi?"),
      aiOutbound(),
      inbound("non ho capito"),
      aiOutbound(),
      inbound("come funziona?"),
      aiOutbound(),
      inbound("ciao"),
    ]);
    await generateAndDeliverReply("conv1");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.escalation.maxTurns",
        meta: expect.objectContaining({ aiTurns: 3 }),
      })
    );
  });

  it("keeps sending below the threshold", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: {
        behavior: { aiMode: "AUTO", maxAiTurns: 3 },
        sending: { randomDelay: false },
      },
    });
    mockDb.message.findMany.mockResolvedValue([
      inbound("come funziona?"),
      aiOutbound(),
      inbound("ciao"),
    ]);
    await generateAndDeliverReply("conv1");
    expect(mockSendText).toHaveBeenCalled();
  });

  it("a human reply resets the counter", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: {
        behavior: { aiMode: "AUTO", maxAiTurns: 3 },
        sending: { randomDelay: false },
      },
    });
    mockDb.message.findMany.mockResolvedValue([
      inbound("ok"),
      aiOutbound(),
      humanOutbound(), // operatore intervenuto
      aiOutbound(),
      aiOutbound(),
      inbound("inizio"),
    ]);
    await generateAndDeliverReply("conv1");
    expect(mockSendText).toHaveBeenCalled();
  });
});

// ── dailyCap ─────────────────────────────────────────────────────────────────

describe("escalation — dailyCap forces DRAFT", () => {
  it("forces DRAFT when today's AI sends reach the cap", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: {
        behavior: { aiMode: "AUTO" },
        sending: { randomDelay: false, dailyCap: 100 },
      },
    });
    mockDb.message.count.mockResolvedValue(100);
    await generateAndDeliverReply("conv1");
    expect(mockSendText).not.toHaveBeenCalled();
    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT" }),
      })
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.cap.daily",
        meta: expect.objectContaining({ sentToday: 100, dailyCap: 100 }),
      })
    );
  });

  it("counts only today's OUT aiGenerated sends, session-scoped", async () => {
    await generateAndDeliverReply("conv1");
    expect(mockDb.message.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversation: { sessionId: "wa1" },
          direction: "OUT",
          aiGenerated: true,
          createdAt: { gte: expect.any(Date) },
        }),
      })
    );
  });

  it("sends below the cap", async () => {
    mockDb.message.count.mockResolvedValue(50);
    await generateAndDeliverReply("conv1");
    expect(mockSendText).toHaveBeenCalled();
  });
});
