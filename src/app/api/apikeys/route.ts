/**
 * Gestione API key (NextAuth, tenant-scoped). POST ritorna il plaintext UNA
 * sola volta. La lista mostra solo prefix + metadati.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, resolveTenantId, canAccessTenant } from "@/lib/authz";
import { generateApiKey } from "@/lib/apikey";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tenantId = await resolveTenantId(actor, new URL(req.url).searchParams.get("tenantId"));
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const keys = await db.apiKey.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, prefix: true, label: true, scopes: true, lastUsedAt: true, createdAt: true,
      sessionId: true, session: { select: { phoneLabel: true } } },
  });
  return Response.json({ keys });
}

const createSchema = z.object({
  tenantId: z.string().optional(),
  label: z.string().min(1).max(80),
  scopes: z.array(z.string()).default(["messages:send"]),
  sessionId: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  // Il tenant deriva dal numero scelto (non dal "primo tenant" dell'attore):
  // così un utente multi-tenant/admin può creare key per un numero di un
  // qualsiasi tenant a cui ha accesso.
  const session = await db.waSession.findFirst({
    where: { id: parsed.data.sessionId, deletedAt: null },
    select: { id: true, tenantId: true },
  });
  if (!session) return Response.json({ error: "numero non valido" }, { status: 400 });
  if (!canAccessTenant(actor, session.tenantId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const generated = generateApiKey();
  const created = await db.apiKey.create({
    data: {
      tenantId,
      sessionId: session.id,
      hashedKey: generated.hashedKey,
      prefix: generated.prefix,
      label: parsed.data.label,
      scopes: parsed.data.scopes,
    },
    select: { id: true, prefix: true, label: true, scopes: true, createdAt: true },
  });

  await auditLog({
    userId: actor.userId,
    tenantId,
    action: "apikey.create",
    entity: "ApiKey",
    entityId: created.id,
    meta: { label: created.label, scopes: created.scopes },
  });

  return Response.json({ key: created, plaintext: generated.plaintext }, { status: 201 });
}
