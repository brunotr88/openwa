/**
 * Auto-close inbox — esegue inbox.autoCloseInactiveDays (settings/schema.ts),
 * finora salvato ma mai eseguito. Invocato dal cron /api/internal/outbound/tick.
 *
 * Per ogni tenant con autoCloseInactiveDays > 0, marca CLOSED le conversazioni
 * OPEN il cui lastMessageAt è più vecchio della soglia. Non tocca SNOOZED/CLOSED
 * (non "riapriamo" nulla) né le conversazioni senza lastMessageAt (mai iniziate).
 */
import { db } from "@/lib/db";
import { parseTenantSettings } from "@/lib/settings/merge";

export interface AutoCloseSummary {
  /** Tenant con autoCloseInactiveDays > 0 esaminati. */
  tenantsChecked: number;
  /** Conversazioni marcate CLOSED. */
  closed: number;
}

export async function autoCloseInactiveConversations(
  now: Date = new Date()
): Promise<AutoCloseSummary> {
  const tenants = await db.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true, settings: true },
  });

  let tenantsChecked = 0;
  let closed = 0;

  for (const tenant of tenants) {
    const settings = parseTenantSettings(tenant.settings);
    const days = settings.inbox.autoCloseInactiveDays;
    if (!days || days <= 0) continue;
    tenantsChecked++;

    const cutoff = new Date(now.getTime() - days * 24 * 3_600_000);
    const result = await db.conversation.updateMany({
      where: {
        tenantId: tenant.id,
        status: "OPEN",
        lastMessageAt: { lt: cutoff },
      },
      data: { status: "CLOSED" },
    });
    closed += result.count;
  }

  return { tenantsChecked, closed };
}
