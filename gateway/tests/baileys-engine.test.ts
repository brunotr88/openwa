// BaileysEngine unit tests.
//
// We fully mock @whiskeysockets/baileys (makeWASocket + useMultiFileAuthState,
// plus the named enums/helpers the engine imports) and the Prisma db module, so
// NO real WebSocket and NO real DB are ever touched. The mocked socket exposes a
// tiny event bus we can drive from the test to simulate connection.update /
// messages.upsert events and assert the engine's reaction.

import { describe, it, expect, vi, beforeEach } from "vitest";

// A minimal event emitter mimicking sock.ev: handlers keyed by event name.
type Handler = (...args: any[]) => any;

interface FakeSocket {
  ev: { on(event: string, cb: Handler): void };
  sendMessage: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  __emit(event: string, payload: any): void;
}

// vi.mock factories are hoisted to the top of the file, so all shared mock refs
// must be created via vi.hoisted (also hoisted) to be in scope when they run.
const h = vi.hoisted(() => {
  function makeFakeSocket(): FakeSocket {
    const handlers = new Map<string, Handler[]>();
    return {
      ev: {
        on(event: string, cb: Handler) {
          const arr = handlers.get(event) ?? [];
          arr.push(cb);
          handlers.set(event, arr);
        },
      },
      sendMessage: vi.fn(async () => ({ key: { id: "ACK-1" } })),
      end: vi.fn(),
      logout: vi.fn(async () => {}),
      __emit(event: string, payload: any) {
        for (const cb of handlers.get(event) ?? []) cb(payload);
      },
    };
  }

  const state = { lastSocket: undefined as FakeSocket | undefined };
  const makeWASocketMock = vi.fn(() => {
    state.lastSocket = makeFakeSocket();
    return state.lastSocket;
  });
  const saveCredsMock = vi.fn(async () => {});
  const waSessionFindUnique = vi.fn(async () => ({ tenantId: "tenant-1" }));
  const toDataURLMock = vi.fn(async () => "data:image/png;base64,FAKE");

  return { state, makeWASocketMock, saveCredsMock, waSessionFindUnique, toDataURLMock };
});

const { makeWASocketMock, saveCredsMock, waSessionFindUnique } = h;

// ── Mock Prisma db (no real DB) ───────────────────────────────────────────────
vi.mock("../src/db", () => ({
  db: { waSession: { findUnique: h.waSessionFindUnique } },
}));

// ── Mock Baileys ──────────────────────────────────────────────────────────────
vi.mock("@whiskeysockets/baileys", () => ({
  default: h.makeWASocketMock,
  makeWASocket: h.makeWASocketMock,
  useMultiFileAuthState: vi.fn(async () => ({
    state: { creds: {}, keys: {} },
    saveCreds: h.saveCredsMock,
  })),
  fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 3000, 0] })),
  Browsers: { appropriate: () => ["OpenWA", "Chrome", "1.0"] },
  DisconnectReason: { loggedOut: 401 },
}));

// qrcode.toDataURL → deterministic fake PNG data URL.
vi.mock("qrcode", () => ({
  default: { toDataURL: h.toDataURLMock },
}));

// Import AFTER mocks are registered.
import { BaileysEngine } from "../src/baileys-engine";

beforeEach(() => {
  vi.clearAllMocks();
  waSessionFindUnique.mockResolvedValue({ tenantId: "tenant-1" });
});

describe("BaileysEngine", () => {
  it("creates a socket on startSession and wires creds/connection/messages", async () => {
    const engine = new BaileysEngine();
    await engine.startSession("sess-1");

    expect(makeWASocketMock).toHaveBeenCalledOnce();
    // saveCreds is registered via creds.update → emitting it should call saveCreds.
    h.state.lastSocket!.__emit("creds.update", {});
    expect(saveCredsMock).toHaveBeenCalledOnce();
  });

  it("captures the QR (raw + data URL) on connection.update with qr, status→QR", async () => {
    const engine = new BaileysEngine();
    const statuses: Array<[string, string]> = [];
    engine.onStatusChange((id, s) => statuses.push([id, s]));

    await engine.startSession("sess-1");
    h.state.lastSocket!.__emit("connection.update", { qr: "RAW-QR-STRING" });
    // let the async qrcode.toDataURL().then() settle
    await Promise.resolve();
    await Promise.resolve();

    const q = engine.getQr("sess-1");
    expect(q.status).toBe("QR");
    expect(q.qr).toBe("RAW-QR-STRING");
    expect(q.qrDataUrl).toBe("data:image/png;base64,FAKE");
    expect(statuses).toContainEqual(["sess-1", "QR"]);
  });

  it("sets status CONNECTED on connection 'open' and clears the QR", async () => {
    const engine = new BaileysEngine();
    const statuses: string[] = [];
    engine.onStatusChange((_id, s) => statuses.push(s));

    await engine.startSession("sess-1");
    h.state.lastSocket!.__emit("connection.update", { qr: "RAW-QR" });
    h.state.lastSocket!.__emit("connection.update", { connection: "open" });

    const q = engine.getQr("sess-1");
    expect(q.status).toBe("CONNECTED");
    expect(q.qr).toBeUndefined();
    expect(statuses).toContain("CONNECTED");
  });

  it("delivers an inbound (not fromMe) message to the handler with parsed text/waId/name", async () => {
    const engine = new BaileysEngine();
    const received: any[] = [];
    engine.onMessage(async (msg) => {
      received.push(msg);
    });

    await engine.startSession("sess-1");

    h.state.lastSocket!.__emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: { fromMe: false, remoteJid: "39333000111@s.whatsapp.net", id: "MSG-1" },
          pushName: "Mario",
          messageTimestamp: 1_700_000_000,
          message: { conversation: "Ciao" },
        },
      ],
    });

    // resolveTenantId is async → flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(waSessionFindUnique).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      select: { tenantId: true },
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      sessionId: "sess-1",
      tenantId: "tenant-1",
      waId: "39333000111",
      contactName: "Mario",
      body: "Ciao",
      externalId: "MSG-1",
      timestamp: 1_700_000_000_000,
    });
  });

  it("extracts text from extendedTextMessage when conversation is absent", async () => {
    const engine = new BaileysEngine();
    const received: any[] = [];
    engine.onMessage(async (msg) => {
      received.push(msg);
    });

    await engine.startSession("sess-1");
    h.state.lastSocket!.__emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: { fromMe: false, remoteJid: "39333000111@s.whatsapp.net", id: "MSG-2" },
          pushName: "Mario",
          messageTimestamp: 1_700_000_001,
          message: { extendedTextMessage: { text: "Reply body" } },
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(received).toHaveLength(1);
    expect(received[0].body).toBe("Reply body");
  });

  it("ignores fromMe messages and non-notify upserts", async () => {
    const engine = new BaileysEngine();
    const received: any[] = [];
    engine.onMessage(async (msg) => {
      received.push(msg);
    });
    await engine.startSession("sess-1");

    // fromMe → ignored
    h.state.lastSocket!.__emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: { fromMe: true, remoteJid: "39333000111@s.whatsapp.net", id: "X" },
          message: { conversation: "echo" },
        },
      ],
    });
    // non-notify (history/append) → ignored
    h.state.lastSocket!.__emit("messages.upsert", {
      type: "append",
      messages: [
        {
          key: { fromMe: false, remoteJid: "39333000111@s.whatsapp.net", id: "Y" },
          message: { conversation: "old" },
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(received).toHaveLength(0);
  });

  it("startSession is idempotent: a second call reuses the live socket", async () => {
    const engine = new BaileysEngine();
    await engine.startSession("sess-1");
    await engine.startSession("sess-1");
    expect(makeWASocketMock).toHaveBeenCalledOnce();
  });

  it("sendText sends to the JID and returns the message id ack", async () => {
    const engine = new BaileysEngine();
    await engine.startSession("sess-1");
    const res = await engine.sendText("sess-1", "39333000111", "hi");

    expect(h.state.lastSocket!.sendMessage).toHaveBeenCalledWith("39333000111@s.whatsapp.net", {
      text: "hi",
    });
    expect(res).toEqual({ ack: "ACK-1" });
  });

  it("stopSession ends the socket and reports OFFLINE", async () => {
    const engine = new BaileysEngine();
    await engine.startSession("sess-1");
    await engine.stopSession("sess-1");

    expect(h.state.lastSocket!.end).toHaveBeenCalledOnce();
    expect(engine.getQr("sess-1").status).toBe("OFFLINE");
  });

  it("does NOT auto-reconnect when the close reason is loggedOut", async () => {
    const engine = new BaileysEngine();
    await engine.startSession("sess-1");
    expect(makeWASocketMock).toHaveBeenCalledTimes(1);

    // Simulate a loggedOut close (Boom with output.statusCode 401).
    h.state.lastSocket!.__emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    await new Promise((r) => setTimeout(r, 0));

    // No new socket created → no reconnect.
    expect(makeWASocketMock).toHaveBeenCalledTimes(1);
    expect(engine.getQr("sess-1").status).toBe("OFFLINE");
  });

  it("auto-reconnects (recreates socket) on a transient close", async () => {
    const engine = new BaileysEngine();
    await engine.startSession("sess-1");
    expect(makeWASocketMock).toHaveBeenCalledTimes(1);

    // Transient close (statusCode 428 connectionClosed, not loggedOut).
    h.state.lastSocket!.__emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 428 } } },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(makeWASocketMock).toHaveBeenCalledTimes(2);
  });
});
