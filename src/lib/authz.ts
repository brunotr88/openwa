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

/**
 * Resolves the working tenant for single-tenant operations (settings,
 * playground): explicit id (must be accessible) → actor's first tenant →
 * first ACTIVE tenant for global admins. Returns null when none available.
 */
export async function resolveTenantId(
  actor: RequestActor,
  requested?: string | null
): Promise<string | null> {
  if (requested) {
    return canAccessTenant(actor, requested) ? requested : null;
  }
  if (actor.tenantIds && actor.tenantIds.length > 0) return actor.tenantIds[0];
  if (actor.tenantIds === null) {
    const { db } = await import("./db");
    const first = await db.tenant.findFirst({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    return first?.id ?? null;
  }
  return null;
}
