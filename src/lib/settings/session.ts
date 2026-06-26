/**
 * Settings per-numero (WaSession.settings). parseSettingsWithFallback è pura:
 * sceglie la sorgente (sessione → tenant → default) e la valida con i merge
 * esistenti. get/save sono i wrapper DB.
 */
import { db } from "@/lib/db";
import type { TenantSettings } from "./schema";
import { tenantSettingsSchema } from "./schema";
import { deepMerge, isPlainObject, parseTenantSettings } from "./merge";

/** Sorgente effettiva: settings sessione se non null, altrimenti tenant, altrimenti default. */
export function parseSettingsWithFallback(
  sessionStored: unknown,
  tenantStored: unknown
): TenantSettings {
  if (sessionStored != null) return parseTenantSettings(sessionStored);
  if (tenantStored != null) return parseTenantSettings(tenantStored);
  return parseTenantSettings(null);
}

export async function getSessionSettings(sessionId: string): Promise<TenantSettings> {
  const session = await db.waSession.findUnique({
    where: { id: sessionId },
    select: { settings: true, tenant: { select: { settings: true } } },
  });
  return parseSettingsWithFallback(session?.settings ?? null, session?.tenant?.settings ?? null);
}

/** Deep-merge del patch sopra i settings effettivi del numero, validazione, persist su WaSession.settings. */
export async function saveSessionSettings(
  sessionId: string,
  patch: unknown
): Promise<TenantSettings> {
  const current = await getSessionSettings(sessionId);
  const merged = deepMerge(current, isPlainObject(patch) ? patch : {});
  const next = tenantSettingsSchema.parse(merged);
  await db.waSession.update({ where: { id: sessionId }, data: { settings: next } });
  return next;
}
