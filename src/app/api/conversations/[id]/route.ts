/**
 * Conversation detail + mode toggle.
 * GET   → conversation with messages (oldest first)
 * PATCH → { mode: AUTO|COPILOT|MANUAL }
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  mode: z.enum(["AUTO", "COPILOT", "MANUAL"]),
});

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const conversation = await db.conversation.findFirst({
    where: { id, deletedAt: null },
    include: {
      contact: { select: { id: true, waId: true, name: true, phone: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          direction: true,
          body: true,
          status: true,
          aiGenerated: true,
          source: true,
          createdAt: true,
        },
      },
    },
  });
  if (!conversation || !canAccessTenant(actor, conversation.tenantId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json({
    conversation: {
      id: conversation.id,
      mode: conversation.mode,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      contact: conversation.contact,
      messages: conversation.messages,
    },
  });
}

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const conversation = await db.conversation.findFirst({
    where: { id, deletedAt: null },
  });
  if (!conversation || !canAccessTenant(actor, conversation.tenantId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  await db.conversation.update({
    where: { id: conversation.id },
    data: { mode: parsed.data.mode },
  });

  await auditLog({
    userId: actor.userId,
    tenantId: conversation.tenantId,
    action: "conversation.mode.update",
    entity: "Conversation",
    entityId: conversation.id,
    meta: { from: conversation.mode, to: parsed.data.mode },
  });

  return Response.json({ ok: true, mode: parsed.data.mode });
}
