/**
 * COPILOT approval: send a DRAFT message via the gateway (optionally edited).
 * POST { body?: string } → DRAFT → SENT (or FAILED)
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { sendText } from "@/lib/wa/gateway-client";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  body: z.string().min(1).max(4096).optional(),
});

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const message = await db.message.findFirst({
    where: { id, status: "DRAFT", direction: "OUT" },
    include: {
      conversation: { include: { contact: true, session: true } },
    },
  });
  if (!message || !canAccessTenant(actor, message.tenantId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const conversation = message.conversation;
  if (!conversation.session.sessionDataRef) {
    return Response.json({ error: "session not linked to gateway" }, { status: 409 });
  }

  // Edits before approval are applied to the same message.
  const finalBody = parsed.data.body?.trim() || message.body || "";
  if (!finalBody) {
    return Response.json({ error: "empty message" }, { status: 400 });
  }
  const edited = finalBody !== message.body;

  // Claim atomico: solo la prima approvazione passa DRAFT→QUEUED. Una seconda
  // richiesta concorrente trova count=0 e non re-invia (no doppio invio).
  const claim = await db.message.updateMany({
    where: { id: message.id, status: "DRAFT" },
    data: { status: "QUEUED" },
  });
  if (claim.count === 0) {
    return Response.json({ error: "already_processed" }, { status: 409 });
  }

  try {
    await sendText(
      conversation.session.sessionDataRef,
      conversation.contact.phone ?? conversation.contact.waId,
      finalBody
    );
  } catch (e) {
    console.error("[messages/approve] gateway send failed:", e);
    await db.message.update({
      where: { id: message.id },
      data: { body: finalBody, status: "FAILED" },
    });
    return Response.json({ error: "send failed" }, { status: 502 });
  }

  await db.message.update({
    where: { id: message.id },
    data: { body: finalBody, status: "SENT" },
  });
  await db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  await auditLog({
    userId: actor.userId,
    tenantId: message.tenantId,
    action: "message.draft.approved",
    entity: "Message",
    entityId: message.id,
    meta: { conversationId: conversation.id, edited },
  });

  return Response.json({ ok: true, messageId: message.id });
}
