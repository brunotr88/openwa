/**
 * Sessions API.
 * GET  → list WaSessions (tenant-filtered)
 * POST → create gateway session + WaSession, start it, register webhook
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { tenantFilter } from "@/lib/tenancy";
import {
  createSession,
  startSession,
  registerWebhook,
  deleteSession,
  GatewayError,
} from "@/lib/wa/gateway-client";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  phoneLabel: z.string().min(1).max(100),
  tenantId: z.string().min(1).optional(),
});

/** Gateway session names: [a-zA-Z0-9-], 3-50 chars. */
function gatewayName(phoneLabel: string): string {
  const slug = phoneLabel
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 38);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug || "session"}-${suffix}`.slice(0, 50);
}

export async function GET(): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sessions = await db.waSession.findMany({
    where: { ...tenantFilter(actor.tenantIds), deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tenantId: true,
      phoneLabel: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });
  return Response.json({ sessions });
}

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const { phoneLabel } = parsed.data;

  // Resolve tenant: explicit (must be accessible) or the actor's first tenant.
  let tenantId = parsed.data.tenantId;
  if (tenantId) {
    if (!canAccessTenant(actor, tenantId)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (actor.tenantIds && actor.tenantIds.length > 0) {
    tenantId = actor.tenantIds[0];
  } else if (actor.tenantIds === null) {
    const first = await db.tenant.findFirst({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    tenantId = first?.id;
  }
  if (!tenantId) {
    return Response.json({ error: "no tenant available" }, { status: 400 });
  }

  const appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL;
  const webhookSecret = process.env.WA_WEBHOOK_SECRET;

  let gwId: string | null = null;
  try {
    // 1. Create + start the gateway session.
    const gwSession = await createSession(gatewayName(phoneLabel));
    gwId = gwSession.id;

    // 2. Register the webhook before starting (no missed events).
    if (appUrl && webhookSecret) {
      await registerWebhook(
        gwId,
        `${appUrl.replace(/\/+$/, "")}/api/webhooks/wa`,
        [
          "message.received",
          "session.status",
          "session.authenticated",
          "session.disconnected",
        ],
        webhookSecret
      );
    } else {
      console.warn("[sessions] APP_URL/WA_WEBHOOK_SECRET missing — webhook not registered");
    }

    // 3. Start (QR generation kicks off).
    await startSession(gwId);
  } catch (e) {
    // Best-effort cleanup of a half-created gateway session.
    if (gwId) await deleteSession(gwId).catch(() => undefined);
    const msg = e instanceof GatewayError ? e.message : "gateway error";
    console.error("[sessions] create failed:", e);
    return Response.json({ error: msg }, { status: 502 });
  }

  const waSession = await db.waSession.create({
    data: {
      tenantId,
      phoneLabel,
      status: "QR",
      sessionDataRef: gwId,
    },
  });

  await auditLog({
    userId: actor.userId,
    tenantId,
    action: "wa.session.create",
    entity: "WaSession",
    entityId: waSession.id,
    meta: { gatewaySessionId: gwId, phoneLabel },
  });

  return Response.json(
    {
      session: {
        id: waSession.id,
        tenantId: waSession.tenantId,
        phoneLabel: waSession.phoneLabel,
        status: waSession.status,
      },
    },
    { status: 201 }
  );
}
