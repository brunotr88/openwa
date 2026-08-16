import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockGenerateReply } = vi.hoisted(() => ({
  mockDb: {
    waSession: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    contact: { upsert: vi.fn(), update: vi.fn() },
    tenant: { findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), updateMany: vi.fn() },
    webhookDelivery: { create: vi.fn(), findUnique: vi.fn() },
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
    timestamp: new Date().toISOString(),
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
  mockDb.message.updateMany.mockResolvedValue({ count: 1 });
  mockDb.webhookDelivery.create.mockResolvedValue({});
  mockDb.webhookDelivery.findUnique.mockResolvedValue(null);
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

  // Anti-replay (hardening post-incidente 13/08): la firma copre il body, che
  // contiene il timestamp; senza finestra di validità un payload firmato
  // intercettato resterebbe rigiocabile per sempre.
  it("rifiuta un payload firmato ma vecchio (replay)", async () => {
    const stale = {
      ...messageReceivedEnvelope(),
      timestamp: new Date(Date.now() - 30 * 60_000).toISOString(),
    };
    const res = await POST(makeRequest(stale));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "stale timestamp" });
    expect(mockDb.message.create).not.toHaveBeenCalled();
  });

  it("accetta comunque un payload senza timestamp leggibile (fail-open deliberato)", async () => {
    // Il formato del timestamp lo decide il gateway: un fail-closed qui
    // bloccherebbe TUTTI gli inbound, il danno peggiore possibile per il bot.
    const noTs = { ...messageReceivedEnvelope(), timestamp: "non-una-data" };
    const res = await POST(makeRequest(noTs));
    expect(res.status).toBe(200);
    expect(mockDb.message.create).toHaveBeenCalled();
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

  it("self-heals a stale OFFLINE session back to CONNECTED on inbound message", async () => {
    mockDb.waSession.findFirst.mockResolvedValue({
      id: "wa1",
      tenantId: "t1",
      sessionDataRef: "sess-abc",
      status: "OFFLINE",
    });
    const res = await POST(makeRequest(messageReceivedEnvelope()));
    expect(res.status).toBe(200);
    expect(mockDb.waSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wa1" },
        data: expect.objectContaining({ status: "CONNECTED", lastSeenAt: expect.any(Date) }),
      })
    );
  });

  it("does NOT resurrect a BANNED session on inbound message", async () => {
    mockDb.waSession.findFirst.mockResolvedValue({
      id: "wa1",
      tenantId: "t1",
      sessionDataRef: "sess-abc",
      status: "BANNED",
    });
    const res = await POST(makeRequest(messageReceivedEnvelope()));
    expect(res.status).toBe(200);
    expect(mockDb.waSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wa1" },
        data: { lastSeenAt: expect.any(Date) },
      })
    );
  });
});

// ── message.ack ───────────────────────────────────────────────────────────────

describe("POST /api/webhooks/wa — message.ack", () => {
  function ackEnvelope(data: Record<string, unknown>) {
    return {
      event: "message.ack",
      timestamp: new Date().toISOString(),
      sessionId: "gw-session-uuid",
      idempotencyKey: "ack_1",
      data,
    };
  }

  it("ack=2 (device) → DELIVERED, matched by waMessageId, OUT only, not regressing READ", async () => {
    const res = await POST(makeRequest(ackEnvelope({ id: "wamid.ABC", ack: 2 })));
    expect(res.status).toBe(200);
    expect(mockDb.message.updateMany).toHaveBeenCalledWith({
      where: { waMessageId: "wamid.ABC", direction: "OUT", status: "SENT" },
      data: { status: "DELIVERED" },
    });
  });

  it("ack=3 (read) → READ, allows matching SENT or DELIVERED (no regression to DELIVERED)", async () => {
    const res = await POST(makeRequest(ackEnvelope({ id: "wamid.ABC", ack: 3 })));
    expect(res.status).toBe(200);
    expect(mockDb.message.updateMany).toHaveBeenCalledWith({
      where: { waMessageId: "wamid.ABC", direction: "OUT", status: { in: ["SENT", "DELIVERED"] } },
      data: { status: "READ" },
    });
  });

  it("ack below DEVICE (0/1) does nothing", async () => {
    const res = await POST(makeRequest(ackEnvelope({ id: "wamid.ABC", ack: 1 })));
    expect(res.status).toBe(200);
    expect(mockDb.message.updateMany).not.toHaveBeenCalled();
  });

  it("missing id or ack is ignored safely", async () => {
    const res = await POST(makeRequest(ackEnvelope({ ack: 3 })));
    expect(res.status).toBe(200);
    expect(mockDb.message.updateMany).not.toHaveBeenCalled();
  });
});

// ── session.status ───────────────────────────────────────────────────────────

describe("POST /api/webhooks/wa — session.status", () => {
  function statusEnvelope(status: string) {
    return {
      event: "session.status",
      timestamp: new Date().toISOString(),
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

// ── Idempotenza: check-prima / marca-solo-dopo-successo ────────────────────────
//
// Regression coverage per l'incidente: la dedup-row NON deve mai essere scritta
// prima che l'evento sia processato con successo, altrimenti un retry del
// gateway dopo un fallimento verrebbe scartato come "duplicato" e il messaggio
// andrebbe perso per sempre.

describe("POST /api/webhooks/wa — idempotenza (check-prima/marca-dopo-successo)", () => {
  it("un handler fallito NON scrive la dedup-row → il retry successivo riprocessa davvero", async () => {
    // In-memory store per simulare l'unicità di WebhookDelivery.key.
    const store = new Set<string>();
    mockDb.webhookDelivery.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      store.has(where.key) ? { key: where.key } : null
    );
    mockDb.webhookDelivery.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      if (store.has(data.key)) {
        const err = new Error("Unique constraint failed") as Error & { code?: string };
        err.code = "P2002";
        throw err;
      }
      store.add(data.key);
      return { key: data.key };
    });

    // Primo tentativo: il DB fallisce dentro l'handler (message.create esplode).
    mockDb.message.create.mockRejectedValueOnce(new Error("db down"));

    const envelope = messageReceivedEnvelope();
    const res1 = await POST(makeRequest(envelope));
    expect(res1.status).toBe(500);
    // Nessuna riga di dedup scritta dopo il fallimento.
    expect(mockDb.webhookDelivery.create).not.toHaveBeenCalled();
    expect(store.size).toBe(0);

    // Retry del gateway con lo STESSO payload: il processing ora va a buon fine.
    mockDb.message.create.mockResolvedValueOnce({ id: "m1" });
    const res2 = await POST(makeRequest(envelope));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok?: boolean; deduped?: boolean };
    expect(body2.deduped).not.toBe(true);
    // Il messaggio è stato davvero salvato al retry, non scartato come duplicato.
    expect(mockDb.message.create).toHaveBeenCalledTimes(2);
    // E ora la dedup-row è stata marcata (best-effort, dopo successo). La chiave è
    // derivata dall'id WA del messaggio (NON dal deliveryId/idempotencyKey del
    // gateway, inaffidabili: inviano costanti come "msg_unknown").
    expect(store.has("recv:true_393331234567@c.us_ABC")).toBe(true);
  });

  it("due messaggi DIVERSI con lo stesso deliveryId costante del gateway (msg_unknown) vengono ENTRAMBI processati", async () => {
    // Regressione dell'incidente 3/8: il fork invia deliveryId/idempotencyKey
    // costante ("msg_unknown") per ogni messaggio. Se ci fidassimo di quello, solo
    // il primo messaggio passerebbe e tutti i successivi verrebbero scartati come
    // duplicati. La chiave deve derivare dall'id WA del messaggio.
    const store = new Set<string>();
    mockDb.webhookDelivery.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      store.has(where.key) ? { key: where.key } : null
    );
    mockDb.webhookDelivery.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      store.add(data.key);
      return { key: data.key };
    });
    mockDb.message.create.mockResolvedValue({ id: "m1" });

    const common = { idempotencyKey: "msg_unknown", deliveryId: "msg_unknown" };
    const res1 = await POST(makeRequest({ ...messageReceivedEnvelope({ id: "wamid.MSG1", body: "primo" }), ...common }));
    const res2 = await POST(makeRequest({ ...messageReceivedEnvelope({ id: "wamid.MSG2", body: "secondo" }), ...common }));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as { deduped?: boolean }).deduped).not.toBe(true);
    // Entrambi salvati, chiavi distinte per-messaggio.
    expect(mockDb.message.create).toHaveBeenCalledTimes(2);
    expect(store.has("recv:wamid.MSG1")).toBe(true);
    expect(store.has("recv:wamid.MSG2")).toBe(true);
  });

  it("stessa delivery processata con successo due volte → la seconda è deduped e l'handler non rigira", async () => {
    const store = new Set<string>();
    mockDb.webhookDelivery.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      store.has(where.key) ? { key: where.key } : null
    );
    mockDb.webhookDelivery.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      store.add(data.key);
      return { key: data.key };
    });

    const envelope = messageReceivedEnvelope();

    const res1 = await POST(makeRequest(envelope));
    expect(res1.status).toBe(200);
    expect(mockDb.message.create).toHaveBeenCalledTimes(1);

    const res2 = await POST(makeRequest(envelope));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok?: boolean; deduped?: boolean };
    expect(body2.deduped).toBe(true);
    // Handler NON rieseguito sulla delivery duplicata.
    expect(mockDb.message.create).toHaveBeenCalledTimes(1);
  });
});
