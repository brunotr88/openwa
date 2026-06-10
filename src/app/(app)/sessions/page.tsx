/**
 * Sessions page — server component (auth + tenant filter), interactive
 * parts delegated to the SessionsClient component.
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { accessibleTenantIds, tenantFilter } from "@/lib/tenancy";
import { SessionsClient, type SessionItem } from "./sessions-client";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const isAdmin = (session.user as { role?: string }).role === "ADMIN";
  const ids = await accessibleTenantIds(session.user.id, isAdmin);

  const sessions = await db.waSession.findMany({
    where: { ...tenantFilter(ids), deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      phoneLabel: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });

  const items: SessionItem[] = sessions.map((s) => ({
    id: s.id,
    phoneLabel: s.phoneLabel,
    status: s.status,
    lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Sessioni WhatsApp
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Collega e gestisci i numeri WhatsApp del tuo workspace.
        </p>
      </div>
      <SessionsClient initialSessions={items} />
    </div>
  );
}
