/**
 * Settings layout — server component: auth + tenant resolve + settings load;
 * la parte interattiva è delegata alla SettingsShell (client).
 */
import { redirect } from "next/navigation";
import { getActor, resolveTenantId } from "@/lib/authz";
import { getTenantSettings } from "@/lib/settings";
import { SettingsShell } from "@/components/settings/settings-shell";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const tenantId = await resolveTenantId(actor);
  if (!tenantId) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center text-sm text-muted-foreground">
        Nessun workspace disponibile per questo utente.
      </div>
    );
  }

  const settings = await getTenantSettings(tenantId);

  return (
    <SettingsShell tenantId={tenantId} initialSettings={settings}>
      {children}
    </SettingsShell>
  );
}
