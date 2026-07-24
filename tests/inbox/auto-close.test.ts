import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tenant: { findMany: vi.fn() },
    conversation: { updateMany: vi.fn() },
  },
}));

vi.mock("../../src/lib/db", () => ({ db: mockDb }));

import { autoCloseInactiveConversations } from "../../src/lib/inbox/auto-close";

const NOW = new Date("2026-07-24T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("autoCloseInactiveConversations", () => {
  it("skips tenants with autoCloseInactiveDays = 0 (default)", async () => {
    mockDb.tenant.findMany.mockResolvedValue([
      { id: "t1", settings: { inbox: { autoCloseInactiveDays: 0 } } },
    ]);
    const summary = await autoCloseInactiveConversations(NOW);
    expect(summary).toEqual({ tenantsChecked: 0, closed: 0 });
    expect(mockDb.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("closes OPEN conversations older than the configured threshold", async () => {
    mockDb.tenant.findMany.mockResolvedValue([
      { id: "t1", settings: { inbox: { autoCloseInactiveDays: 30 } } },
    ]);
    mockDb.conversation.updateMany.mockResolvedValue({ count: 3 });

    const summary = await autoCloseInactiveConversations(NOW);

    expect(mockDb.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        status: "OPEN",
        lastMessageAt: { lt: new Date(NOW.getTime() - 30 * 24 * 3_600_000) },
      },
      data: { status: "CLOSED" },
    });
    expect(summary).toEqual({ tenantsChecked: 1, closed: 3 });
  });

  it("does not touch SNOOZED/CLOSED conversations (only filters status: OPEN)", async () => {
    mockDb.tenant.findMany.mockResolvedValue([
      { id: "t1", settings: { inbox: { autoCloseInactiveDays: 7 } } },
    ]);
    mockDb.conversation.updateMany.mockResolvedValue({ count: 0 });
    await autoCloseInactiveConversations(NOW);
    const args = mockDb.conversation.updateMany.mock.calls[0][0];
    expect(args.where.status).toBe("OPEN");
  });

  it("aggregates across multiple tenants", async () => {
    mockDb.tenant.findMany.mockResolvedValue([
      { id: "t1", settings: { inbox: { autoCloseInactiveDays: 10 } } },
      { id: "t2", settings: { inbox: { autoCloseInactiveDays: 0 } } },
      { id: "t3", settings: { inbox: { autoCloseInactiveDays: 5 } } },
    ]);
    mockDb.conversation.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    const summary = await autoCloseInactiveConversations(NOW);

    expect(mockDb.conversation.updateMany).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({ tenantsChecked: 2, closed: 3 });
  });
});
