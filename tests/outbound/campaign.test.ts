import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockDb, mockAuditLog, mockEnsureConversation } = vi.hoisted(() => ({
  mockDb: {
    campaign: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    contact: { findMany: vi.fn() },
    message: { findMany: vi.fn() },
    outboundJob: { create: vi.fn(), groupBy: vi.fn() },
  },
  mockAuditLog: vi.fn(),
  mockEnsureConversation: vi.fn(),
}));

vi.mock("../../src/lib/db", () => ({ db: mockDb }));
vi.mock("../../src/lib/audit", () => ({ auditLog: mockAuditLog }));
vi.mock("../../src/lib/outbound/enqueue", () => ({
  ensureConversation: mockEnsureConversation,
  enqueueOutbound: async (p: { contactId: string }) => {
    const job = await mockDb.outboundJob.create({ data: p });
    return job.id;
  },
}));

import { launchCampaign, campaignStats } from "../../src/lib/outbound/campaign";

const campaign = {
  id: "camp1",
  tenantId: "t1",
  sessionId: "s1",
  mode: "TEXT",
  body: "Ciao {{nome}}",
  templateId: null,
  defaultVars: null,
  scheduledAt: null,
  status: "DRAFT",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.campaign.findUnique.mockResolvedValue(campaign);
  mockDb.campaign.updateMany.mockResolvedValue({ count: 1 });
  mockDb.campaign.update.mockResolvedValue({});
  mockEnsureConversation.mockResolvedValue("conv1");
  mockDb.message.findMany.mockResolvedValue([]);
  mockDb.outboundJob.create.mockResolvedValue({ id: "job1" });
});

describe("launchCampaign — enqueue idempotente (FIX F)", () => {
  it("skips a P2002 on enqueue instead of throwing, counts it as skipped", async () => {
    mockDb.contact.findMany.mockResolvedValue([
      { id: "c1", name: "A", optInStatus: "IN" },
      { id: "c2", name: "B", optInStatus: "IN" },
    ]);
    mockDb.outboundJob.create
      .mockResolvedValueOnce({ id: "job1" })
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));

    const res = await launchCampaign("camp1");
    expect(res).toEqual({ enqueued: 1, skipped: 1 });
  });

  it("re-throws non-P2002 errors from enqueue", async () => {
    mockDb.contact.findMany.mockResolvedValue([{ id: "c1", name: "A", optInStatus: "IN" }]);
    mockDb.outboundJob.create.mockRejectedValue(new Error("db exploded"));
    await expect(launchCampaign("camp1")).rejects.toThrow("db exploded");
  });

  it("allows re-launching a RUNNING campaign (resumable)", async () => {
    mockDb.campaign.findUnique.mockResolvedValue({ ...campaign, status: "RUNNING" });
    mockDb.contact.findMany.mockResolvedValue([{ id: "c1", name: "A", optInStatus: "IN" }]);
    const res = await launchCampaign("camp1");
    expect(res).toEqual({ enqueued: 1, skipped: 0 });
    expect(mockDb.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "camp1", status: { in: ["DRAFT", "RUNNING"] } } })
    );
  });

  it("rejects launching a terminal campaign (DONE/CANCELED)", async () => {
    mockDb.campaign.updateMany.mockResolvedValue({ count: 0 });
    await expect(launchCampaign("camp1")).rejects.toThrow(/not launchable/);
  });
});

describe("eligibleContacts — no N+1 (FIX G)", () => {
  it("issues a single message.findMany for non-IN contacts instead of per-contact count", async () => {
    mockDb.contact.findMany.mockResolvedValue([
      { id: "c1", name: "A", optInStatus: "IN" },
      { id: "c2", name: "B", optInStatus: "UNKNOWN" },
      { id: "c3", name: "C", optInStatus: "UNKNOWN" },
    ]);
    mockDb.message.findMany.mockResolvedValue([
      { conversation: { contactId: "c2" } },
    ]);
    const res = await launchCampaign("camp1");
    // c1 (IN) + c2 (has inbound) enqueued; c3 not eligible.
    expect(res.enqueued).toBe(2);
    expect(mockDb.message.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          direction: "IN",
          conversation: { contactId: { in: ["c2", "c3"] } },
        }),
      })
    );
  });
});

describe("campaignStats — marks DONE when queue is drained (FIX H)", () => {
  it("flips a RUNNING campaign to DONE once pending is 0", async () => {
    mockDb.outboundJob.groupBy.mockResolvedValue([
      { status: "DONE", _count: { _all: 3 } },
      { status: "FAILED", _count: { _all: 1 } },
    ]);
    const stats = await campaignStats("camp1");
    expect(stats).toEqual({ total: 4, pending: 0, sent: 3, failed: 1 });
    expect(mockDb.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: "camp1", status: "RUNNING" },
      data: { status: "DONE" },
    });
  });

  it("does not touch the campaign while jobs are still pending", async () => {
    mockDb.outboundJob.groupBy.mockResolvedValue([
      { status: "PENDING", _count: { _all: 2 } },
    ]);
    await campaignStats("camp1");
    expect(mockDb.campaign.updateMany).not.toHaveBeenCalled();
  });

  it("does not update anything when there are no jobs at all", async () => {
    mockDb.outboundJob.groupBy.mockResolvedValue([]);
    await campaignStats("camp1");
    expect(mockDb.campaign.updateMany).not.toHaveBeenCalled();
  });
});
