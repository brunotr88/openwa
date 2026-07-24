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
import { getActor, resolveTenantId, canAccessTenant } from "@/lib/authz";
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

  // No explicit tenant requested and the actor is scoped to specific tenants
  // (not a global admin): the inbox spans every accessible tenant, so the
  // backfill must too — otherwise only the first tenant's contacts resolve.
  let tenantIds: string[];
  if (requested) {
    if (!canAccessTenant(actor, requested)) {
      return Response.json({ error: "no tenant" }, { status: 400 });
    }
    tenantIds = [requested];
  } else if (actor.tenantIds && actor.tenantIds.length > 0) {
    tenantIds = actor.tenantIds;
  } else {
    const fallback = await resolveTenantId(actor, undefined);
    if (!fallback) return Response.json({ error: "no tenant" }, { status: 400 });
    tenantIds = [fallback];
  }

  let updated = 0;
  let scanned = 0;
  let anySessionFound = false;

  for (const tenantId of tenantIds) {
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
    if (!session?.sessionDataRef) continue; // stale/no session for this tenant → skip, don't abort the others
    const gwSessionId = session.sessionDataRef;
    anySessionFound = true;

    const contacts = await db.contact.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ name: null }, { phone: null }],
      },
      take: MAX_PER_RUN,
      select: { id: true, waId: true, name: true, phone: true },
    });

    for (const c of contacts) {
      scanned++;
      for (const candidate of candidateContactIds(c.waId)) {
        let gwContact;
        try {
          gwContact = await getContact(gwSessionId, candidate);
        } catch {
          // Session status in DB was stale (e.g. actually disconnected) —
          // skip this contact instead of aborting the whole run.
          break;
        }
        const resolved = mapGatewayContact(gwContact);
        const patch = resolutionPatch(resolved, { name: c.name, phone: c.phone });
        if (Object.keys(patch).length > 0) {
          await db.contact.update({ where: { id: c.id }, data: patch });
          updated++;
          break; // resolved → don't try the other suffix
        }
        // If we got a real phone but no new fields (already set), stop too.
        if (resolved.phone || resolved.name) break;
      }
      await sleep(DELAY_MS);
    }

    await auditLog({
      userId: actor.userId,
      tenantId,
      action: "contact.resolve.backfill",
      entity: "Contact",
      meta: { scanned: contacts.length, updated },
    });
  }

  if (!anySessionFound) {
    return Response.json(
      { error: "Nessuna sessione WhatsApp connessa per questo tenant." },
      { status: 409 }
    );
  }

  return Response.json({ ok: true, scanned, updated });
}
