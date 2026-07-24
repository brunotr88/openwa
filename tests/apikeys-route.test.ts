import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockGetActor, mockCanAccessTenant } = vi.hoisted(() => ({
  mockDb: {
    apiKey: { findMany: vi.fn() },
  },
  mockGetActor: vi.fn(),
  mockCanAccessTenant: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({ db: mockDb }));
vi.mock("../src/lib/audit", () => ({ auditLog: vi.fn() }));
vi.mock("../src/lib/authz", () => ({
  getActor: mockGetActor,
  canAccessTenant: mockCanAccessTenant,
  resolveTenantId: vi.fn(),
}));

import { GET } from "../src/app/api/apikeys/route";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.apiKey.findMany.mockResolvedValue([]);
});

describe("GET /api/apikeys — scope allineato a /api/sessions", () => {
  it("multi-tenant: lista le key di TUTTI i tenant accessibili, non solo del primo", async () => {
    mockGetActor.mockResolvedValue({ userId: "u1", isAdmin: false, tenantIds: ["t1", "t2"] });

    await GET(new Request("http://x/api/apikeys"));

    expect(mockDb.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: { in: ["t1", "t2"] } }),
      })
    );
  });

  it("global admin (tenantIds null): nessun filtro tenantId nel where", async () => {
    mockGetActor.mockResolvedValue({ userId: "admin", isAdmin: true, tenantIds: null });

    await GET(new Request("http://x/api/apikeys"));

    const where = mockDb.apiKey.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBeUndefined();
  });

  it("tenantId esplicito e accessibile: filtra su quel solo tenant", async () => {
    mockGetActor.mockResolvedValue({ userId: "u1", isAdmin: false, tenantIds: ["t1", "t2"] });
    mockCanAccessTenant.mockReturnValue(true);

    await GET(new Request("http://x/api/apikeys?tenantId=t2"));

    expect(mockDb.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: "t2" }) })
    );
  });

  it("tenantId esplicito non accessibile: 403", async () => {
    mockGetActor.mockResolvedValue({ userId: "u1", isAdmin: false, tenantIds: ["t1"] });
    mockCanAccessTenant.mockReturnValue(false);

    const res = await GET(new Request("http://x/api/apikeys?tenantId=t2"));
    expect(res.status).toBe(403);
    expect(mockDb.apiKey.findMany).not.toHaveBeenCalled();
  });

  it("non autenticato: 401", async () => {
    mockGetActor.mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/apikeys"));
    expect(res.status).toBe(401);
  });
});
