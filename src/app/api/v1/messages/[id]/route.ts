/** Stato di un OutboundJob (delivery feedback per le app integranti). */
import { db } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await authenticateApiKey(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const job = await db.outboundJob.findFirst({
    where: { id, tenantId: actor.tenantId }, // IDOR: scoping per tenant della key
    select: {
      id: true,
      status: true,
      mode: true,
      attempts: true,
      lastError: true,
      messageId: true,
      scheduledAt: true,
      sentAt: true,
      createdAt: true,
    },
  });
  if (!job) return Response.json({ error: "not_found" }, { status: 404 });

  let messageStatus: string | null = null;
  if (job.messageId) {
    const m = await db.message.findUnique({
      where: { id: job.messageId },
      select: { status: true },
    });
    messageStatus = m?.status ?? null;
  }
  return Response.json({ ...job, messageStatus });
}
