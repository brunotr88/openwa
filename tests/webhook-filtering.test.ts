import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockGenerateReply } = vi.hoisted(() => ({
  mockDb: {
    waSession: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    contact: { upsert: vi.fn() },
    tenant: { findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn() },
  },
  mockGenerateReply: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({ db: mockDb }));
vi.mock("../src/lib/wa/reply", () => ({
  generateAndDeliverReply: mockGenerateReply,
}));

import { POST } from "../src/app/api/webhooks/wa/route";
import { shouldIgnoreInbound } from "../src/lib/wa/inbound-filter";
import { recommendedDefaults, parseTenantSettings } from "../src/lib/settings";

// ── Helpers ──────────────────────────────────────────────────────────────────

const SECRET = "test-webhook-secret";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function makeRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  return new Request("https://openwa.example.com/api/webhooks/wa", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openwa-signature": sign(body),
    },
    body,
  });
}

function envelope(data: Record<string, unknown>) {
  return {
    event: "message.received",
    timestamp: "2026-06-10T10:00:00.000Z",
    sessionId: "gw-session-uuid",
    data: {
      id: "true_393331234567@c.us_ABC",
      from: "393331234567@c.us",
      chatId: "393331234567@c.us",
      body: "Ciao!",
      type: "chat",
      fromMe: false,
      isGroup: false,
      ...data,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WA_WEBHOOK_SECRET = SECRET;

  mockDb.waSession.findFirst.mockResolvedValue({
    id: "wa1",
    tenantId: "t1",
    sessionDataRef: "gw-session-uuid",
    status: "CONNECTED",
  });
  mockDb.waSession.update.mockResolvedValue({});
  mockDb.contact.upsert.mockResolvedValue({ id: "c1", tenantId: "t1" });
  mockDb.tenant.findUnique.mockResolvedValue({ settings: null }); // defaults
  // getSessionSettings (route → settings per-numero) legge waSession.findUnique
  // e ripiega su tenant.settings: deleghiamo al mock tenant esistente così gli
  // override `tenant.findUnique` dei singoli test restano validi.
  mockDb.waSession.findUnique.mockImplementation(async () => ({
    settings: null,
    tenant: await mockDb.tenant.findUnique(),
  }));
  mockDb.conversation.findFirst.mockResolvedValue(null);
  mockDb.conversation.create.mockResolvedValue({ id: "conv1", mode: "COPILOT" });
  mockDb.conversation.update.mockResolvedValue({});
  mockDb.message.create.mockResolvedValue({ id: "m1" });
  mockGenerateReply.mockResolvedValue("m2");
});

// ── shouldIgnoreInbound (unit, whatsapp-ops.md table) ────────────────────────

describe("shouldIgnoreInbound — JID filtering", () => {
  const s = recommendedDefaults;

  it("ignores status@broadcast (stati/storie)", () => {
    expect(
      shouldIgnoreInbound({ chatId: "status@broadcast", type: "chat" }, s)
    ).toBe(true);
  });

  it("ignores *@newsletter (canali WhatsApp)", () => {
    expect(
      shouldIgnoreInbound({ chatId: "12036304@newsletter", type: "chat" }, s)
    ).toBe(true);
  });

  it("ignores broadcast lists ([timestamp]@broadcast)", () => {
    expect(
      shouldIgnoreInbound({ chatId: "1234567890@broadcast", type: "chat" }, s)
    ).toBe(true);
  });

  it("ignores fromMe echoes (loop prevention)", () => {
    expect(
      shouldIgnoreInbound({ chatId: "39333@c.us", type: "chat", fromMe: true }, s)
    ).toBe(true);
  });

  it("keeps 1:1 chats (@c.us / @s.whatsapp.net) and @lid contacts", () => {
    expect(shouldIgnoreInbound({ chatId: "39333@c.us", type: "chat" }, s)).toBe(false);
    expect(
      shouldIgnoreInbound({ chatId: "39333@s.whatsapp.net", type: "chat" }, s)
    ).toBe(false);
    expect(shouldIgnoreInbound({ chatId: "98765@lid", type: "chat" }, s)).toBe(false);
  });

  it("keeps groups with default settings (mostra_no_ai)", () => {
    expect(
      shouldIgnoreInbound({ chatId: "123-456@g.us", type: "chat", isGroup: true }, s)
    ).toBe(false);
  });

  it("ignores groups when inbox.filterGroups is 'ignora'", () => {
    const ignora = parseTenantSettings({ inbox: { filterGroups: "ignora" } });
    expect(
      shouldIgnoreInbound(
        { chatId: "123-456@g.us", type: "chat", isGroup: true },
        ignora
      )
    ).toBe(true);
  });
});

describe("shouldIgnoreInbound — type filtering", () => {
  const s = recommendedDefaults;

  it.each([
    "reaction",
    "message_reaction",
    "e2e_notification",
    "notification_template",
    "protocol",
    "revoked",
    "gp2",
    "call_log",
    "ciphertext",
  ])("ignores type %s", (type) => {
    expect(shouldIgnoreInbound({ chatId: "39333@c.us", type }, s)).toBe(true);
  });

  it("keeps regular chat types", () => {
    expect(shouldIgnoreInbound({ chatId: "39333@c.us", type: "chat" }, s)).toBe(false);
    expect(shouldIgnoreInbound({ chatId: "39333@c.us", type: "image" }, s)).toBe(false);
  });
});

// ── Route integration ────────────────────────────────────────────────────────

describe("POST /api/webhooks/wa — filtering integration", () => {
  it("drops status@broadcast without storing anything", async () => {
    const res = await POST(makeRequest(envelope({ chatId: "status@broadcast" })));
    expect(res.status).toBe(200);
    expect(mockDb.contact.upsert).not.toHaveBeenCalled();
    expect(mockDb.message.create).not.toHaveBeenCalled();
    expect(mockGenerateReply).not.toHaveBeenCalled();
  });

  it("drops newsletter and reaction events", async () => {
    await POST(makeRequest(envelope({ chatId: "111@newsletter" })));
    await POST(makeRequest(envelope({ type: "reaction" })));
    expect(mockDb.message.create).not.toHaveBeenCalled();
  });

  it("treats @lid as a normal contact, waId stored without suffix", async () => {
    const res = await POST(
      makeRequest(envelope({ chatId: "987654321@lid", from: "987654321@lid" }))
    );
    expect(res.status).toBe(200);
    expect(mockDb.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_waId: { tenantId: "t1", waId: "987654321" } },
      })
    );
    expect(mockGenerateReply).toHaveBeenCalled();
  });

  it("stores group messages (MANUAL) without triggering the AI", async () => {
    const res = await POST(
      makeRequest(envelope({ chatId: "123-456@g.us", isGroup: true }))
    );
    expect(res.status).toBe(200);
    expect(mockDb.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: "MANUAL" }),
      })
    );
    expect(mockDb.message.create).toHaveBeenCalled();
    expect(mockGenerateReply).not.toHaveBeenCalled();
  });

  it("groups can auto-reply only with the explicit groupAutoReply opt-in", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: {
        behavior: { aiMode: "AUTO" },
        sending: { groupAutoReply: true },
      },
    });
    mockDb.conversation.create.mockResolvedValue({ id: "convG", mode: "AUTO" });
    await POST(makeRequest(envelope({ chatId: "123-456@g.us", isGroup: true })));
    expect(mockGenerateReply).toHaveBeenCalledWith("convG");
  });

  it("skips groups entirely when inbox.filterGroups is 'ignora'", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: { inbox: { filterGroups: "ignora" } },
    });
    await POST(makeRequest(envelope({ chatId: "123-456@g.us", isGroup: true })));
    expect(mockDb.contact.upsert).not.toHaveBeenCalled();
    expect(mockDb.message.create).not.toHaveBeenCalled();
  });
});
