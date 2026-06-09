// Inbound message handler (spec §6).
//
// For every received WhatsApp message:
//   1. upsert Contact by (tenantId, waId)
//   2. find an OPEN Conversation for that contact+session, or create one
//   3. create Message(direction=IN, status=RECEIVED, source=WA)
//   4. bump Conversation.lastMessageAt
//   5. if Conversation.mode === AUTO and the tenant's AiConfig.autoReplyEnabled,
//      ask the web app to generate+send a reply (best-effort, never throws)
//
// The Prisma client and the reply requester are injected so this is unit-testable
// without a real DB or HTTP server (and without ever launching Chromium).

import { db as defaultDb } from "./db";
import { requestReply as defaultRequestReply } from "./web-client";
import type { InboundMsg } from "./engine";

export interface InboundDeps {
  db: typeof defaultDb;
  requestReply: typeof defaultRequestReply;
}

const defaultDeps: InboundDeps = {
  db: defaultDb,
  requestReply: defaultRequestReply,
};

export async function handleInbound(
  msg: InboundMsg,
  deps: InboundDeps = defaultDeps
): Promise<void> {
  const { db, requestReply } = deps;

  // 1. upsert Contact (tenantId + waId is unique in the schema)
  const contact = await db.contact.upsert({
    where: { tenantId_waId: { tenantId: msg.tenantId, waId: msg.waId } },
    create: {
      tenantId: msg.tenantId,
      waId: msg.waId,
      name: msg.contactName ?? null,
    },
    update: msg.contactName ? { name: msg.contactName } : {},
  });

  // 2. find an open conversation for this contact on this session, else create
  let conversation = await db.conversation.findFirst({
    where: {
      tenantId: msg.tenantId,
      contactId: contact.id,
      sessionId: msg.sessionId,
      status: "OPEN",
      deletedAt: null,
    },
  });

  if (!conversation) {
    conversation = await db.conversation.create({
      data: {
        tenantId: msg.tenantId,
        contactId: contact.id,
        sessionId: msg.sessionId,
      },
    });
  }

  // 3. persist the inbound message
  await db.message.create({
    data: {
      conversationId: conversation.id,
      tenantId: msg.tenantId,
      direction: "IN",
      body: msg.body ?? null,
      mediaRef: msg.media?.url ?? msg.media?.dataUrl ?? null,
      status: "RECEIVED",
      source: "WA",
    },
  });

  // 4. bump lastMessageAt
  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(msg.timestamp) },
  });

  // 5. AUTO + autoReplyEnabled → request an AI reply from the web app
  if (conversation.mode === "AUTO") {
    const aiConfig = await db.aiConfig.findUnique({
      where: { tenantId: msg.tenantId },
    });
    if (aiConfig?.autoReplyEnabled) {
      await requestReply(conversation.id);
    }
  }
}
