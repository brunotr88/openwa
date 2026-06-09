import { describe, it, expect, vi } from "vitest";
import { handleInbound, type InboundDeps } from "../src/inbound";
import type { InboundMsg } from "../src/engine";

const baseMsg: InboundMsg = {
  sessionId: "sess-1",
  tenantId: "tenant-1",
  waId: "39333000111@c.us",
  contactName: "Mario",
  body: "Ciao",
  timestamp: 1_700_000_000_000,
};

/**
 * Build a mock Prisma client + requestReply spy. `mode` controls the
 * conversation mode returned by findFirst; `autoReplyEnabled` controls AiConfig.
 */
function makeDeps(opts: {
  existingConversation?: boolean;
  mode?: "AUTO" | "COPILOT" | "MANUAL";
  autoReplyEnabled?: boolean;
}) {
  const conversation = {
    id: "conv-1",
    tenantId: baseMsg.tenantId,
    contactId: "contact-1",
    sessionId: baseMsg.sessionId,
    mode: opts.mode ?? "MANUAL",
    status: "OPEN",
  };

  const db = {
    contact: {
      upsert: vi.fn(async () => ({ id: "contact-1", tenantId: baseMsg.tenantId, waId: baseMsg.waId })),
    },
    conversation: {
      findFirst: vi.fn(async () => (opts.existingConversation === false ? null : conversation)),
      create: vi.fn(async () => conversation),
      update: vi.fn(async () => conversation),
    },
    message: {
      create: vi.fn(async () => ({ id: "msg-1" })),
    },
    aiConfig: {
      findUnique: vi.fn(async () => ({
        tenantId: baseMsg.tenantId,
        autoReplyEnabled: opts.autoReplyEnabled ?? false,
      })),
    },
  };

  const requestReply = vi.fn(async () => true);

  return { db, requestReply, deps: { db, requestReply } as unknown as InboundDeps };
}

describe("handleInbound", () => {
  it("always upserts Contact and creates a Message(IN, RECEIVED, WA)", async () => {
    const { db, deps } = makeDeps({ mode: "MANUAL" });
    await handleInbound(baseMsg, deps);

    expect(db.contact.upsert).toHaveBeenCalledOnce();
    expect(db.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_waId: { tenantId: "tenant-1", waId: baseMsg.waId } },
      })
    );

    expect(db.message.create).toHaveBeenCalledOnce();
    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conv-1",
          tenantId: "tenant-1",
          direction: "IN",
          status: "RECEIVED",
          source: "WA",
          body: "Ciao",
        }),
      })
    );
  });

  it("creates a new conversation when none is open", async () => {
    const { db, deps } = makeDeps({ existingConversation: false, mode: "MANUAL" });
    await handleInbound(baseMsg, deps);
    expect(db.conversation.create).toHaveBeenCalledOnce();
  });

  it("reuses an existing open conversation", async () => {
    const { db, deps } = makeDeps({ mode: "MANUAL" });
    await handleInbound(baseMsg, deps);
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it("AUTO + autoReplyEnabled triggers requestReply", async () => {
    const { db, requestReply, deps } = makeDeps({ mode: "AUTO", autoReplyEnabled: true });
    await handleInbound(baseMsg, deps);
    expect(db.aiConfig.findUnique).toHaveBeenCalledWith({ where: { tenantId: "tenant-1" } });
    expect(requestReply).toHaveBeenCalledOnce();
    expect(requestReply).toHaveBeenCalledWith("conv-1");
  });

  it("AUTO but autoReplyEnabled=false does NOT trigger requestReply", async () => {
    const { requestReply, deps } = makeDeps({ mode: "AUTO", autoReplyEnabled: false });
    await handleInbound(baseMsg, deps);
    expect(requestReply).not.toHaveBeenCalled();
  });

  it("COPILOT does NOT trigger requestReply", async () => {
    const { db, requestReply, deps } = makeDeps({ mode: "COPILOT", autoReplyEnabled: true });
    await handleInbound(baseMsg, deps);
    expect(requestReply).not.toHaveBeenCalled();
    // COPILOT must not even consult AiConfig for auto-reply.
    expect(db.aiConfig.findUnique).not.toHaveBeenCalled();
  });

  it("MANUAL does NOT trigger requestReply", async () => {
    const { requestReply, deps } = makeDeps({ mode: "MANUAL", autoReplyEnabled: true });
    await handleInbound(baseMsg, deps);
    expect(requestReply).not.toHaveBeenCalled();
  });
});
