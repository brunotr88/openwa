import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma so the route can be tested without a DB.
const findFirst = vi.fn();
vi.mock("../src/lib/db", () => ({
  db: { conversation: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

vi.mock("../src/lib/authz", () => ({
  getActor: vi.fn(async () => ({ id: "u1", isGlobalAdmin: true, tenantIds: null })),
  canAccessTenant: vi.fn(() => true),
}));

import { GET } from "../src/app/api/conversations/[id]/route";

describe("GET /api/conversations/[id]", () => {
  beforeEach(() => findFirst.mockReset());

  it("returns the most recent 200 messages in oldest-first order", async () => {
    // Prisma call returns newest-first (desc + take 200) as requested by the route.
    findFirst.mockResolvedValue({
      id: "c1",
      tenantId: "t1",
      mode: "AUTO",
      status: "OPEN",
      lastMessageAt: new Date("2026-01-03"),
      contact: { id: "ct1", waId: "39123", name: null, phone: "39123" },
      messages: [
        { id: "m3", direction: "IN", body: "newest", status: "RECEIVED", aiGenerated: false, source: "WA", createdAt: new Date("2026-01-03") },
        { id: "m2", direction: "OUT", body: "middle", status: "SENT", aiGenerated: false, source: "WA", createdAt: new Date("2026-01-02") },
        { id: "m1", direction: "IN", body: "oldest", status: "RECEIVED", aiGenerated: false, source: "WA", createdAt: new Date("2026-01-01") },
      ],
    });

    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "c1" }) });
    const json = await res.json();

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          messages: expect.objectContaining({
            orderBy: { createdAt: "desc" },
            take: 200,
          }),
        }),
      })
    );

    // FE expects oldest-first order for rendering + scroll-to-bottom.
    expect(json.conversation.messages.map((m: { id: string }) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });
});
