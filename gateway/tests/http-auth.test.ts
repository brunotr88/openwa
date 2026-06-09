import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, safeTokenEqual, bearerGuard } from "../src/http";
import type { WaEngine } from "../src/engine";

const SECRET = "super-secret-internal-token";

function fakeEngine(): WaEngine {
  return {
    startSession: vi.fn(async () => ({ qr: "QR123", status: "QR" as const })),
    stopSession: vi.fn(async () => {}),
    sendText: vi.fn(async () => ({ ack: "ACK" })),
    sendMedia: vi.fn(async () => ({ ack: "ACK" })),
    onMessage: vi.fn(),
    onStatusChange: vi.fn(),
  };
}

/** Spin up the app on an ephemeral port and return a request helper. */
async function withServer(secret: string) {
  const app = createApp({ engine: fakeEngine(), secret });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;

  const call = (
    path: string,
    opts: { method?: string; token?: string; body?: unknown } = {}
  ) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token !== undefined ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

  return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("safeTokenEqual (constant-time compare)", () => {
  it("returns true for identical tokens", () => {
    expect(safeTokenEqual(SECRET, SECRET)).toBe(true);
  });
  it("returns false for different tokens of equal length", () => {
    expect(safeTokenEqual("a".repeat(SECRET.length), SECRET)).toBe(false);
  });
  it("returns false for tokens of different length (no throw on mismatch)", () => {
    expect(safeTokenEqual("short", SECRET)).toBe(false);
    expect(safeTokenEqual(SECRET + "extra", SECRET)).toBe(false);
  });
  it("denies everything when the expected secret is empty", () => {
    expect(safeTokenEqual("anything", "")).toBe(false);
    expect(safeTokenEqual("", "")).toBe(false);
  });
});

describe("bearerGuard middleware", () => {
  it("rejects missing token with 401 and calls next() only when valid", () => {
    const guard = bearerGuard(SECRET);
    const next = vi.fn();
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;

    guard({ headers: {} } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();

    next.mockClear();
    guard({ headers: { authorization: `Bearer ${SECRET}` } } as any, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("HTTP routes auth", () => {
  it("GET /health is UNGUARDED and returns ok", async () => {
    const { call, close } = await withServer(SECRET);
    try {
      const res = await call("/health");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await close();
    }
  });

  it("rejects guarded route with NO token (401)", async () => {
    const { call, close } = await withServer(SECRET);
    try {
      const res = await call("/send", {
        method: "POST",
        body: { sessionId: "s1", waId: "x@c.us", text: "hi" },
      });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it("rejects guarded route with WRONG token (401)", async () => {
    const { call, close } = await withServer(SECRET);
    try {
      const res = await call("/send", {
        method: "POST",
        token: "wrong-token",
        body: { sessionId: "s1", waId: "x@c.us", text: "hi" },
      });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it("accepts guarded route with RIGHT token", async () => {
    const { call, close } = await withServer(SECRET);
    try {
      const res = await call("/send", {
        method: "POST",
        token: SECRET,
        body: { sessionId: "s1", waId: "x@c.us", text: "hi" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ack: "ACK" });
    } finally {
      await close();
    }
  });

  it("validates body on guarded routes (400) even with valid token", async () => {
    const { call, close } = await withServer(SECRET);
    try {
      const res = await call("/session/start", { method: "POST", token: SECRET, body: {} });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });
});
