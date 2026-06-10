/**
 * Deep-merge + parse puri (client-safe, zero import server-side).
 * Usati sia dal server (getTenantSettings) sia dai client component
 * (optimistic update nel SettingsProvider).
 */
import { tenantSettingsSchema, type TenantSettings } from "./schema";
import { recommendedDefaults } from "./defaults";

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge ricorsivo di oggetti plain; gli array vengono sostituiti. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T)) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value)
        ? deepMerge(current, value)
        : value;
  }
  return out as T;
}

/** Parsa un JSON parziale/sporco in TenantSettings completo (mai throw). */
export function parseTenantSettings(stored: unknown): TenantSettings {
  const merged = deepMerge(
    recommendedDefaults,
    isPlainObject(stored) ? stored : {}
  );
  const parsed = tenantSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : recommendedDefaults;
}
