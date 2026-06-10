/**
 * Conversations list (inbox) — tenant-filtered, latest first.
 */
import { db } from "@/lib/db";
import { getActor } from "@/lib/authz";
import { tenantFilter } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const conversations = await db.conversation.findMany({
    where: { ...tenantFilter(actor.tenantIds), deletedAt: null },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
    take: 100,
    include: {
      contact: { select: { id: true, waId: true, name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, direction: true, status: true, createdAt: true },
      },
    },
  });

  return Response.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      mode: c.mode,
      status: c.status,
      lastMessageAt: c.lastMessageAt,
      contact: c.contact,
      lastMessage: c.messages[0] ?? null,
    })),
  });
}
