import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockGetActor, mockResolveTenantId, mockGetProvider } = vi.hoisted(() => ({
  mockDb: {
    waSession: { findMany: vi.fn() },
    aiConfig: { findUnique: vi.fn() },
  },
  mockGetActor: vi.fn(),
  mockResolveTenantId: vi.fn(),
  mockGetProvider: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({ db: mockDb }));
vi.mock("../src/lib/authz", () => ({
  getActor: mockGetActor,
  resolveTenantId: mockResolveTenantId,
}));
vi.mock("../src/lib/rate-limit", () => ({
  rateLimit: () => ({ allowed: true }),
}));
vi.mock("../src/lib/ai", () => ({
  getProvider: mockGetProvider,
}));

import { POST } from "../src/app/api/playground/route";

function makeRequest(body: unknown): Request {
  return new Request("https://openwa.example.com/api/playground", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/playground — selezione sessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActor.mockResolvedValue({ userId: "u1" });
    mockResolveTenantId.mockResolvedValue("tenant-1");
    mockDb.waSession.findMany.mockResolvedValue([
      { id: "session-a", status: "CONNECTED", createdAt: new Date("2024-01-01") },
      { id: "session-b", status: "CONNECTED", createdAt: new Date("2024-02-01") },
    ]);
    mockDb.aiConfig.findUnique.mockResolvedValue(null);
  });

  it("risponde 400 se il sessionId richiesto non appartiene al tenant (niente fallback silenzioso)", async () => {
    const res = await POST(
      makeRequest({
        tenantId: "tenant-1",
        sessionId: "session-of-another-tenant",
        messages: [{ role: "user", content: "ciao" }],
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid sessionId");
    expect(mockGetProvider).not.toHaveBeenCalled();
  });
});
