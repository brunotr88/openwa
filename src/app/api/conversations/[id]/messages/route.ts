/**
 * Manual reply: operator sends a message in a conversation via the gateway.
 * POST { body: string } → Message(OUT, SENT|FAILED, source WA, aiGenerated=false)
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { sendText } from "@/lib/wa/gateway-client";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  body: z.string().min(1).max(4096),
});

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const conversation = await db.conversation.findFirst({
    where: { id, deletedAt: null },
    include: { contact: true, session: true },
  });
  if (!conversation || !canAccessTenant(actor, conversation.tenantId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (!conversation.session.sessionDataRef) {
    return Response.json({ error: "session not linked to gateway" }, { status: 409 });
  }

  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      direction: "OUT",
      body: parsed.data.body,
      status: "QUEUED",
      aiGenerated: false,
      source: "WA",
    },
  });

  let sendResult;
  try {
    sendResult = await sendText(
      conversation.session.sessionDataRef,
      conversation.contact.phone ?? conversation.contact.waId,
      parsed.data.body
    );
  } catch (e) {
    console.error("[conversations/messages] gateway send failed:", e);
    await db.message.update({
      where: { id: message.id },
      data: { status: "FAILED" },
    });
    return Response.json({ error: "send failed", messageId: message.id }, { status: 502 });
  }

  await db.message.update({
    where: { id: message.id },
    data: { status: "SENT", waMessageId: sendResult.messageId },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  await auditLog({
    userId: actor.userId,
    tenantId: conversation.tenantId,
    action: "message.manual.sent",
    entity: "Message",
    entityId: message.id,
    meta: { conversationId: conversation.id },
  });

  return Response.json({ ok: true, messageId: message.id }, { status: 201 });
}
