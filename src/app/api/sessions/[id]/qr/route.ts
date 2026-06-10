/**
 * QR proxy: returns the gateway QR (data URL) + synced status for polling.
 */
import { db } from "@/lib/db";
import { getActor, canAccessTenant } from "@/lib/authz";
import { getQr, getSession, GatewayError } from "@/lib/wa/gateway-client";
import type { WaSessionStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function mapStatus(gwStatus: string): WaSessionStatus | null {
  switch (gwStatus) {
    case "ready":
      return "CONNECTED";
    case "qr_ready":
      return "QR";
    case "disconnected":
    case "failed":
      return "OFFLINE";
    default:
      return null;
  }
}

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.waSession.findFirst({
    where: { id, deletedAt: null },
  });
  if (!session || !canAccessTenant(actor, session.tenantId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (!session.sessionDataRef) {
    return Response.json({ error: "session not linked to gateway" }, { status: 409 });
  }

  // Sync status from the gateway (webhook is the primary path; this is a
  // poll-time fallback so the UI converges even if a webhook is missed).
  let status: WaSessionStatus = session.status;
  try {
    const gw = await getSession(session.sessionDataRef);
    const mapped = mapStatus(gw.status);
    if (mapped && mapped !== session.status) {
      status = mapped;
      await db.waSession.update({
        where: { id: session.id },
        data: { status: mapped, lastSeenAt: new Date() },
      });
    }
  } catch {
    // gateway unreachable → keep stored status
  }

  if (status === "CONNECTED") {
    return Response.json({ status, qrCode: null });
  }

  try {
    const qr = await getQr(session.sessionDataRef);
    return Response.json({ status, qrCode: qr.qrCode });
  } catch (e) {
    // 400 from the gateway = QR not ready yet (still initializing).
    if (e instanceof GatewayError && e.status === 400) {
      return Response.json({ status, qrCode: null });
    }
    console.error("[sessions/qr] gateway error:", e);
    return Response.json({ status, qrCode: null, error: "gateway unavailable" }, { status: 502 });
  }
}
