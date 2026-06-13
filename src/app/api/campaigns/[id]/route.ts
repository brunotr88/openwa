import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { campaignStats } from "@/lib/outbound/campaign";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await db.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      name: true,
      mode: true,
      body: true,
      status: true,
      totalRecipients: true,
      scheduledAt: true,
      createdAt: true,
    },
  });
  if (!campaign || !canAccessTenant(actor, campaign.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const stats = await campaignStats(id);
  return Response.json({ campaign, stats });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await db.campaign.findUnique({ where: { id }, select: { tenantId: true } });
  if (!campaign || !canAccessTenant(actor, campaign.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await db.outboundJob.updateMany({
    where: { campaignId: id, status: "PENDING" },
    data: { status: "CANCELED", lastError: "campaign_canceled" },
  });
  await db.campaign.update({ where: { id }, data: { status: "CANCELED" } });
  await auditLog({
    userId: actor.userId,
    tenantId: campaign.tenantId,
    action: "campaign.cancel",
    entity: "Campaign",
    entityId: id,
  });
  return Response.json({ ok: true });
}
