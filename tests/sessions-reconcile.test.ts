import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  db: {
    waSession: {
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

const getSessionMock = vi.fn();
vi.mock("@/lib/wa/gateway-client", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

import { reconcileStaleConnected, type ReconcilableSession } from "@/lib/wa/session-reconcile";

const MINUTES = 60 * 1000;

function session(overrides: Partial<ReconcilableSession> = {}): ReconcilableSession {
  return {
    id: "s1",
    status: "CONNECTED",
    lastSeenAt: new Date(),
    sessionDataRef: "gw1",
    ...overrides,
  };
}

describe("reconcileStaleConnected", () => {
  beforeEach(() => {
    updateMock.mockClear();
    getSessionMock.mockReset();
  });

  it("non tocca sessioni CONNECTED con heartbeat recente", async () => {
    const s = session({ lastSeenAt: new Date() });
    const out = await reconcileStaleConnected([s]);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(out).toEqual([s]);
  });

  it("non tocca sessioni non-CONNECTED anche se stale", async () => {
    const s = session({ status: "OFFLINE", lastSeenAt: new Date(Date.now() - 60 * MINUTES) });
    const out = await reconcileStaleConnected([s]);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(out).toEqual([s]);
  });

  it("degrada a OFFLINE una sessione CONNECTED stale se il gateway la vede disconnected (webhook perso)", async () => {
    getSessionMock.mockResolvedValue({ status: "disconnected" });
    const s = session({ lastSeenAt: new Date(Date.now() - 60 * MINUTES) });
    const out = await reconcileStaleConnected([s]);
    expect(getSessionMock).toHaveBeenCalledWith("gw1");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: "OFFLINE", lastSeenAt: expect.any(Date) },
    });
    expect(out[0].status).toBe("OFFLINE");
  });

  it("lascia lo stato invariato se il gateway concorda (ancora ready)", async () => {
    getSessionMock.mockResolvedValue({ status: "ready" });
    const s = session({ lastSeenAt: new Date(Date.now() - 60 * MINUTES) });
    const out = await reconcileStaleConnected([s]);
    expect(updateMock).not.toHaveBeenCalled();
    expect(out).toEqual([s]);
  });

  it("mantiene lo stato DB se il gateway è irraggiungibile", async () => {
    getSessionMock.mockRejectedValue(new Error("network"));
    const s = session({ lastSeenAt: new Date(Date.now() - 60 * MINUTES) });
    const out = await reconcileStaleConnected([s]);
    expect(updateMock).not.toHaveBeenCalled();
    expect(out).toEqual([s]);
  });

  it("riconcilia una sessione senza lastSeenAt (mai vista dopo il DB)", async () => {
    getSessionMock.mockResolvedValue({ status: "failed" });
    const s = session({ lastSeenAt: null });
    const out = await reconcileStaleConnected([s]);
    expect(getSessionMock).toHaveBeenCalled();
    expect(out[0].status).toBe("OFFLINE");
  });
});
