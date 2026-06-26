/** Numero legato alla API key (così il chiamante sa da che numero invia). */
import { db } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await authenticateApiKey(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!actor.sessionId) {
    return Response.json({ error: "number_unavailable" }, { status: 409 });
  }
  const session = await db.waSession.findFirst({
    where: { id: actor.sessionId, deletedAt: null },
    select: { id: true, phoneLabel: true, status: true },
  });
  if (!session) return Response.json({ error: "number_unavailable" }, { status: 409 });
  return Response.json({
    sessionId: session.id,
    phoneLabel: session.phoneLabel,
    status: session.status,
    scopes: actor.scopes,
  });
}
