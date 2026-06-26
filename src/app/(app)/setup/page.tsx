/**
 * Onboarding wizard /setup (M4, dashboard-ux.md) — server shell:
 * auth + tenant + numero primario + settings per-numero + stato connessione.
 */
import { redirect } from "next/navigation";
import { getActor, resolveTenantId } from "@/lib/authz";
import { getSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";
import { db } from "@/lib/db";
import { SetupClient } from "./setup-client";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const tenantId = await resolveTenantId(actor);
  if (!tenantId) redirect("/inbox");

  const numbers = await db.waSession.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, status: true, createdAt: true },
  });
  const sessionId = pickPrimarySession(numbers);
  if (!sessionId) redirect("/sessions");
  const settings = await getSessionSettings(sessionId);
  const hasConnectedSession = numbers.some((n) => n.status === "CONNECTED");

  return (
    <SetupClient
      tenantId={tenantId}
      sessionId={sessionId}
      initialSettings={settings}
      hasConnectedSession={hasConnectedSession}
    />
  );
}
