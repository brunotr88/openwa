/**
 * Route-level auth helper: current user + accessible tenant ids.
 * Blueprint §12.2 — every API route must tenant-filter via these ids.
 */
import { auth } from "./auth";
import { accessibleTenantIds } from "./tenancy";

export interface RequestActor {
  userId: string;
  isAdmin: boolean;
  /** null = global admin (all tenants). */
  tenantIds: string[] | null;
}

/** Returns the authenticated actor, or null (caller responds 401). */
export async function getActor(): Promise<RequestActor | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const isAdmin =
    (session.user as { role?: string }).role === "ADMIN";
  const tenantIds = await accessibleTenantIds(userId, isAdmin);
  return { userId, isAdmin, tenantIds };
}

/** True if the actor can access the given tenant. */
export function canAccessTenant(actor: RequestActor, tenantId: string): boolean {
  return actor.tenantIds === null || actor.tenantIds.includes(tenantId);
}
