/**
 * Onboarding wizard /setup (M4, dashboard-ux.md) — server shell:
 * auth + tenant + settings + sessione WhatsApp esistente.
 */
import { redirect } from "next/navigation";
import { getActor, resolveTenantId } from "@/lib/authz";
import { getTenantSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { SetupClient } from "./setup-client";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const tenantId = await resolveTenantId(actor);
  if (!tenantId) redirect("/inbox");

  const [settings, connectedSession] = await Promise.all([
    getTenantSettings(tenantId),
    db.waSession.findFirst({
      where: { tenantId, status: "CONNECTED", deletedAt: null },
      select: { id: true },
    }),
  ]);

  return (
    <SetupClient
      tenantId={tenantId}
      initialSettings={settings}
      hasConnectedSession={Boolean(connectedSession)}
    />
  );
}
