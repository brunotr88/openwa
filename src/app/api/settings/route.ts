/**
 * Tenant settings API (M4).
 * GET  ?tenantId= → { tenantId, settings } (merged over recommendedDefaults)
 * PUT  { tenantId?, settings: <patch> } → deep-merge + zod-validate + persist
 *      + audit log (changed sections in meta).
 */
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, resolveTenantId } from "@/lib/authz";
import {
  getTenantSettings,
  saveTenantSettings,
  type TenantSettings,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const requested = new URL(req.url).searchParams.get("tenantId");
  const tenantId = await resolveTenantId(actor, requested);
  if (!tenantId) {
    return Response.json({ error: "no tenant available" }, { status: requested ? 403 : 400 });
  }

  const settings = await getTenantSettings(tenantId);

  // Trasparenza sui limiti: "Oggi: X/cap messaggi inviati".
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await db.message.count({
    where: {
      tenantId,
      direction: "OUT",
      status: { in: ["SENT", "DELIVERED", "READ"] },
      createdAt: { gte: startOfDay },
    },
  });

  return Response.json({ tenantId, settings, sentToday });
}

function changedSections(before: TenantSettings, after: TenantSettings): string[] {
  const sections = Object.keys(after) as Array<keyof TenantSettings>;
  return sections.filter(
    (s) => JSON.stringify(before[s]) !== JSON.stringify(after[s])
  );
}

export async function PUT(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    tenantId?: string;
    settings?: unknown;
  } | null;
  if (!body || typeof body !== "object" || !body.settings || typeof body.settings !== "object") {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const tenantId = await resolveTenantId(actor, body.tenantId ?? null);
  if (!tenantId) {
    return Response.json(
      { error: body.tenantId ? "forbidden" : "no tenant available" },
      { status: body.tenantId ? 403 : 400 }
    );
  }

  const before = await getTenantSettings(tenantId);

  let settings: TenantSettings;
  try {
    settings = await saveTenantSettings(tenantId, body.settings);
  } catch (e) {
    if (e instanceof ZodError) {
      return Response.json(
        { error: "invalid settings", issues: e.issues },
        { status: 400 }
      );
    }
    throw e;
  }

  await auditLog({
    userId: actor.userId,
    tenantId,
    action: "tenant.settings.update",
    entity: "Tenant",
    entityId: tenantId,
    meta: { sections: changedSections(before, settings) },
  });

  return Response.json({ tenantId, settings });
}
