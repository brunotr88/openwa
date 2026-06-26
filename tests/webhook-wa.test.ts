import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockGenerateReply } = vi.hoisted(() => ({
  mockDb: {
    waSession: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    contact: { upsert: vi.fn(), update: vi.fn() },
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const SECRET = "test-webhook-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function makeRequest(payload: unknown, signature?: string | null): Request {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) {
    headers["x-openwa-signature"] = signature ?? sign(body);
  }
  return new Request("https://openwa.example.com/api/webhooks/wa", {
    method: "POST",
    headers,
    body,
  });
}

function messageReceivedEnvelope(data: Record<string, unknown> = {}) {
  return {
    event: "message.received",
    timestamp: "2026-06-10T10:00:00.000Z",
    sessionId: "gw-session-uuid",
    idempotencyKey: "msg_abc",
    deliveryId: "dlv_1",
    data: {
      id: "true_393331234567@c.us_ABC",
      from: "393331234567@c.us",
      to: "393339999999@c.us",
      chatId: "393331234567@c.us",
      body: "Ciao, info sul prodotto?",
      type: "chat",
      timestamp: 1780000000,
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
  mockDb.contact.upsert.mockResolvedValue({
    id: "c1",
    tenantId: "t1",
    waId: "393331234567",
    name: null,
    phone: null,
  });
  mockDb.contact.update.mockResolvedValue({});
  // TenantSettings: bot attivo in AUTO
  mockDb.tenant.findUnique.mockResolvedValue({
    settings: { behavior: { aiMode: "AUTO" } },
  });
  // getSessionSettings (route → settings per-numero) legge waSession.findUnique
  // e ripiega su tenant.settings: deleghiamo al mock tenant esistente così gli
  // override `tenant.findUnique` dei singoli test restano validi.
  mockDb.waSession.findUnique.mockImplementation(async () => ({
    settings: null,
    tenant: await mockDb.tenant.findUnique(),
  }));
  mockDb.conversation.findFirst.mockResolvedValue(null);
  mockDb.conversation.create.mockResolvedValue({ id: "conv1", mode: "AUTO" });
  mockDb.conversation.update.mockResolvedValue({});
  mockDb.message.create.mockResolvedValue({ id: "m1" });
  mockGenerateReply.mockResolvedValue("m2");
});

// ── HMAC verification ────────────────────────────────────────────────────────

describe("POST /api/webhooks/wa — signature verification", () => {
  it("rejects a request with no signature header", async () => {
    const res = await POST(makeRequest(messageReceivedEnvelope(), null));
    expect(res.status).toBe(401);
    expect(mockDb.message.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature", async () => {
    const res = await POST(
      makeRequest(messageReceivedEnvelope(), "sha256=" + "0".repeat(64))
    );
    expect(res.status).toBe(401);
    expect(mockDb.message.create).not.toHaveBeenCalled();
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const envelope = messageReceivedEnvelope();
    const res = await POST(
      makeRequest(envelope, sign(JSON.stringify(envelope), "wrong-secret"))
    );
    expect(res.status).toBe(401);
  });

  it("rejects everything when WA_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.WA_WEBHOOK_SECRET;
    const res = await POST(makeRequest(messageReceivedEnvelope()));
    expect(res.status).toBe(401);
  });

  it("accepts a valid HMAC-SHA256 signature (sha256=<hex> of raw body)", async () => {
    const res = await POST(makeRequest(messageReceivedEnvelope()));
    expect(res.status).toBe(200);
  });
});

// ── message.received ─────────────────────────────────────────────────────────

describe("POST /api/webhooks/wa — message.received", () => {
  it("creates Contact + Conversation + Message(IN) and triggers the reply pipeline on AUTO", async () => {
    const res = await POST(makeRequest(messageReceivedEnvelope()));
    expect(res.status).toBe(200);

    // Contact upserted by (tenantId, waId) with the @c.us suffix stripped
    expect(mockDb.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_waId: { tenantId: "t1", waId: "393331234567" } },
      })
    );

    // Conversation created with tenant default mode AUTO (autoReplyEnabled)
    expect(mockDb.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "t1",
          contactId: "c1",
          sessionId: "wa1",
          mode: "AUTO",
          status: "OPEN",
        }),
      })
    );

    // Message(IN, RECEIVED, WA)
    expect(mockDb.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conv1",
          tenantId: "t1",
          direction: "IN",
          body: "Ciao, info sul prodotto?",
          status: "RECEIVED",
          source: "WA",
        }),
      })
    );

    // lastMessageAt bumped + reply pipeline kicked off
    expect(mockDb.conversation.update).toHaveBeenCalled();
    expect(mockGenerateReply).toHaveBeenCalledWith("conv1");
  });

  it("defaults to COPILOT when tenant aiMode is COPILOT", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: { behavior: { aiMode: "COPILOT" } },
    });
    await POST(makeRequest(messageReceivedEnvelope()));
    expect(mockDb.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: "COPILOT" }),
      })
    );
  });

  it("reuses an existing OPEN conversation", async () => {
    mockDb.conversation.findFirst.mockResolvedValue({ id: "conv9", mode: "COPILOT" });
    await POST(makeRequest(messageReceivedEnvelope()));
    expect(mockDb.conversation.create).not.toHaveBeenCalled();
    expect(mockGenerateReply).toHaveBeenCalledWith("conv9");
  });

  it("ignores fromMe messages", async () => {
    const res = await POST(makeRequest(messageReceivedEnvelope({ fromMe: true })));
    expect(res.status).toBe(200);
    expect(mockDb.contact.upsert).not.toHaveBeenCalled();
    expect(mockDb.message.create).not.toHaveBeenCalled();
    expect(mockGenerateReply).not.toHaveBeenCalled();
  });

  it("stores group messages with mode MANUAL and never triggers the AI", async () => {
    const res = await POST(
      makeRequest(
        messageReceivedEnvelope({ isGroup: true, chatId: "12345-67890@g.us" })
      )
    );
    expect(res.status).toBe(200);
    // memorizzato (default inbox.filterGroups = mostra_no_ai)…
    expect(mockDb.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: "MANUAL" }),
      })
    );
    expect(mockDb.message.create).toHaveBeenCalled();
    // …ma MAI auto-reply
    expect(mockGenerateReply).not.toHaveBeenCalled();
  });

  it("returns 200 even when no WaSession matches the gateway session id", async () => {
    mockDb.waSession.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest(messageReceivedEnvelope()));
    expect(res.status).toBe(200);
    expect(mockDb.message.create).not.toHaveBeenCalled();
  });
});

// ── session.status ───────────────────────────────────────────────────────────

describe("POST /api/webhooks/wa — session.status", () => {
  function statusEnvelope(status: string) {
    return {
      event: "session.status",
      timestamp: "2026-06-10T10:00:00.000Z",
      sessionId: "gw-session-uuid",
      data: { status },
    };
  }

  it.each([
    ["ready", "CONNECTED"],
    ["qr_ready", "QR"],
    ["disconnected", "OFFLINE"],
  ])("maps gateway status %s → %s", async (gwStatus, ourStatus) => {
    const res = await POST(makeRequest(statusEnvelope(gwStatus)));
    expect(res.status).toBe(200);
    expect(mockDb.waSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wa1" },
        data: expect.objectContaining({
          status: ourStatus,
          lastSeenAt: expect.any(Date),
        }),
      })
    );
  });

  it("ignores transient statuses (initializing)", async () => {
    const res = await POST(makeRequest(statusEnvelope("initializing")));
    expect(res.status).toBe(200);
    expect(mockDb.waSession.update).not.toHaveBeenCalled();
  });
});
