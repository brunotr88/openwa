import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma client so tenancy.ts can be tested without a DB.
const findMany = vi.fn();
vi.mock("../src/lib/db", () => ({
  db: { userTenant: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import { accessibleTenantIds, tenantFilter } from "../src/lib/tenancy";

describe("accessibleTenantIds", () => {
  beforeEach(() => findMany.mockReset());

  it("returns null for a global admin (no DB hit)", async () => {
    const result = await accessibleTenantIds("u1", true);
    expect(result).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns the user's tenant ids from memberships", async () => {
    findMany.mockResolvedValue([{ tenantId: "t1" }, { tenantId: "t2" }]);
    const result = await accessibleTenantIds("u1", false);
    expect(result).toEqual(["t1", "t2"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { tenantId: true },
    });
  });

  it("returns an empty list when the user has no memberships", async () => {
    findMany.mockResolvedValue([]);
    expect(await accessibleTenantIds("u1", false)).toEqual([]);
  });
});

describe("tenantFilter", () => {
  it("returns an empty where fragment for global admin (null)", () => {
    expect(tenantFilter(null)).toEqual({});
  });

  it("scopes to the provided tenant ids", () => {
    expect(tenantFilter(["t1", "t2"])).toEqual({
      tenantId: { in: ["t1", "t2"] },
    });
  });
});
