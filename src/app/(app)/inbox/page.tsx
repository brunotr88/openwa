/**
 * Inbox — server component shell (auth + setup checklist); data is fetched
 * client-side with polling from /api/conversations (tenant-filtered in API).
 */
import { redirect } from "next/navigation";
import { getActor, resolveTenantId } from "@/lib/authz";
import { getTenantSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { SetupChecklist } from "@/components/settings/setup-checklist";
import { InboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  // Setup checklist finché il wizard non è completato.
  let checklist: React.ReactNode = null;
  const tenantId = await resolveTenantId(actor);
  if (tenantId) {
    const settings = await getTenantSettings(tenantId);
    if (!settings.setup.completed) {
      const connected = await db.waSession.findFirst({
        where: { tenantId, status: "CONNECTED", deletedAt: null },
        select: { id: true },
      });
      checklist = (
        <SetupChecklist settings={settings} hasConnectedSession={Boolean(connected)} />
      );
    }
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-4 md:h-[calc(100dvh-3.5rem)]">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Inbox</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Conversazioni WhatsApp, bozze AI e risposte in un unico posto.
        </p>
      </div>
      {checklist}
      <InboxClient />
    </div>
  );
}
