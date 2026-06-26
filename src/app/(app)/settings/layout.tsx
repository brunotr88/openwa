/**
 * Settings layout — server component: auth + tenant resolve + risoluzione
 * numero (querystring o primario) + caricamento settings per-numero;
 * la parte interattiva è delegata alla SettingsShell (client).
 */
import { redirect } from "next/navigation";
import { getActor, resolveTenantId } from "@/lib/authz";
import { getSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";
import { db } from "@/lib/db";
import { SettingsShell } from "@/components/settings/settings-shell";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
  searchParams,
}: {
  children: React.ReactNode;
  searchParams: Promise<{ sessionId?: string }>;
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
  const numbers = await db.waSession.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, phoneLabel: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (numbers.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center text-sm text-muted-foreground">
        Nessun numero collegato.{" "}
        <a href="/sessions" className="text-primary underline">Collega un numero</a> per configurarlo.
      </div>
    );
  }
  const requested = (await searchParams).sessionId;
  const sessionId =
    (requested && numbers.some((n) => n.id === requested) && requested) ||
    pickPrimarySession(numbers)!;
  const settings = await getSessionSettings(sessionId);

  return (
    <SettingsShell
      tenantId={tenantId}
      sessionId={sessionId}
      numbers={numbers.map((n) => ({ id: n.id, phoneLabel: n.phoneLabel, status: n.status }))}
      initialSettings={settings}
    >
      {children}
    </SettingsShell>
  );
}
