/**
 * Backfill route — resolve real name + phone for the tenant's contacts whose
 * name/phone is still missing, via the gateway. Tenant-scoped (IDOR-safe),
 * rate-limited, returns the number of contacts updated.
 *
 * POST /api/contacts/resolve  { tenantId?: string }
 *   auth: NextAuth session; tenant must be accessible to the actor.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { getActor, resolveTenantId } from "@/lib/authz";
import { auditLog } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { getContact } from "@/lib/wa/gateway-client";
import {
  candidateContactIds,
  mapGatewayContact,
  resolutionPatch,
} from "@/lib/wa/contact-resolve";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ tenantId: z.string().optional() }).optional();

/** Max contacts processed per call + delay between gateway calls (rate limit). */
const MAX_PER_RUN = 50;
const DELAY_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (!rateLimit(`contacts-resolve:${actor.userId}`, 20, 60_000).allowed) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => undefined));
  const requested = parsed.success ? parsed.data?.tenantId : undefined;
  const tenantId = await resolveTenantId(actor, requested);
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  // Need a gateway session id to call the contacts endpoint.
  const session = await db.waSession.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      status: "CONNECTED",
      sessionDataRef: { not: null },
    },
    orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
    select: { sessionDataRef: true },
  });
  if (!session?.sessionDataRef) {
    return Response.json(
      { error: "Nessuna sessione WhatsApp connessa per questo tenant." },
      { status: 409 }
    );
  }
  const gwSessionId = session.sessionDataRef;

  const contacts = await db.contact.findMany({
    where: {
      tenantId,
      deletedAt: null,
      OR: [{ name: null }, { phone: null }],
    },
    take: MAX_PER_RUN,
    select: { id: true, waId: true, name: true, phone: true },
  });

  let updated = 0;
  let scanned = 0;
  for (const c of contacts) {
    scanned++;
    let patchApplied = false;
    for (const candidate of candidateContactIds(c.waId)) {
      const resolved = mapGatewayContact(await getContact(gwSessionId, candidate));
      const patch = resolutionPatch(resolved, { name: c.name, phone: c.phone });
      if (Object.keys(patch).length > 0) {
        await db.contact.update({ where: { id: c.id }, data: patch });
        updated++;
        patchApplied = true;
        break; // resolved → don't try the other suffix
      }
      // If we got a real phone but no new fields (already set), stop too.
      if (resolved.phone || resolved.name) break;
    }
    void patchApplied;
    if (scanned < contacts.length) await sleep(DELAY_MS);
  }

  await auditLog({
    userId: actor.userId,
    tenantId,
    action: "contact.resolve.backfill",
    entity: "Contact",
    meta: { scanned, updated },
  });

  return Response.json({ ok: true, scanned, updated });
}
