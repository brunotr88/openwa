/**
 * Audit log helper — fire-and-forget (blueprint §12.6).
 * Never throws: a failed audit write must not break the calling mutation.
 */
import { db } from "./db";

export interface AuditParams {
  userId?: string | null;
  tenantId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Records an audit entry. Call on every mutation and on sensitive reveals.
 * Errors are swallowed (logged only) so the caller's flow is never interrupted.
 */
export async function auditLog(params: AuditParams): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: params.userId ?? null,
        tenantId: params.tenantId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        meta: (params.meta ?? undefined) as object | undefined,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  } catch (e) {
    console.error("[audit]", e);
  }
}
