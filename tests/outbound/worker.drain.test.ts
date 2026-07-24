import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockAuditLog } = vi.hoisted(() => ({
  mockDb: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    webhookDelivery: { deleteMany: vi.fn() },
    outboundJob: { updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  mockAuditLog: vi.fn(),
}));

vi.mock("../../src/lib/db", () => ({ db: mockDb }));
vi.mock("../../src/lib/audit", () => ({ auditLog: mockAuditLog }));

import { drainOutbound } from "../../src/lib/outbound/worker";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$queryRaw.mockResolvedValue([{ locked: true }]);
  mockDb.$executeRaw.mockResolvedValue(undefined);
  mockDb.webhookDelivery.deleteMany.mockResolvedValue({ count: 0 });
  mockDb.outboundJob.updateMany.mockResolvedValue({ count: 0 });
  mockDb.outboundJob.findMany.mockResolvedValue([]);
});

describe("drainOutbound — advisory lock (FIX B)", () => {
  it("acquires and releases the advisory lock around the drain body", async () => {
    await drainOutbound();
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("exits immediately without touching the queue when the lock is already held", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ locked: false }]);
    const summary = await drainOutbound();
    expect(summary).toEqual({ processed: 0, sent: 0, failed: 0, skipped: 0 });
    expect(mockDb.outboundJob.findMany).not.toHaveBeenCalled();
    // no lock held → nothing to release
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();
  });

  it("releases the lock even if the drain body throws", async () => {
    mockDb.outboundJob.findMany.mockRejectedValue(new Error("db down"));
    await expect(drainOutbound()).rejects.toThrow("db down");
    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("caps the due-jobs query with take (FIX C)", async () => {
    await drainOutbound();
    expect(mockDb.outboundJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 })
    );
  });
});

describe("drainOutbound — a single job throwing does not abort the drain (FIX A)", () => {
  it("continues to the next job and counts the thrown one as failed", async () => {
    mockDb.outboundJob.findMany.mockResolvedValue([
      { id: "job1", sessionId: "s1" },
      { id: "job2", sessionId: "s2" },
    ]);
    // First job: lock succeeds but findUnique throws (simulates an unhandled
    // exception inside sendOneJob). Second job: lock fails → "skipped".
    mockDb.outboundJob.updateMany.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "job1") return { count: 1 };
      return { count: 0 };
    });
    mockDb.outboundJob.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "job1") throw new Error("boom");
      return null;
    });

    const summary = await drainOutbound();
    expect(summary.processed).toBe(2);
    expect(summary.failed).toBe(1); // job1 threw → counted as failed
    expect(summary.skipped).toBe(1); // job2 lock lost → skipped
  });
});
