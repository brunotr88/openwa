/**
 * Multi-tenant access helper.
 * Blueprint §12.2 — IDOR prevention: use accessibleTenantIds on every query.
 */
import { db } from "./db";

/**
 * Returns the list of tenant IDs a user can access.
 * Returns null if the user is a global ADMIN (can access all tenants).
 *
 * Usage in queries:
 *   const ids = await accessibleTenantIds(userId, isAdmin);
 *   const items = await db.resource.findMany({
 *     where: { ...(ids ? { tenantId: { in: ids } } : {}) },
 *   });
 */
export async function accessibleTenantIds(
  userId: string,
  isGlobalAdmin: boolean
): Promise<string[] | null> {
  if (isGlobalAdmin) return null;

  const memberships = await db.userTenant.findMany({
    where: { userId },
    select: { tenantId: true },
  });

  return memberships.map((m) => m.tenantId);
}

/**
 * Builds a Prisma `where` clause fragment for tenant filtering.
 * Pass the result directly into your query's `where`.
 */
export function tenantFilter(
  ids: string[] | null
): { tenantId?: { in: string[] } } {
  if (ids === null) return {};
  return { tenantId: { in: ids } };
}
