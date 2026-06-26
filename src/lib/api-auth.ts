/**
 * Auth per l'API privata /api/v1/*. Legge X-Api-Key, calcola lo SHA-256,
 * cerca la ApiKey attiva (deletedAt null) per hash, conferma con
 * timingSafeEqual (Task 2) e ritorna tenant/scope. Aggiorna lastUsedAt
 * fire-and-forget. Ritorna null su key assente/sconosciuta/revocata.
 */
import { db } from "@/lib/db";
import { hashApiKey, verifyApiKey } from "@/lib/apikey";

export interface ApiKeyActor {
  keyId: string;
  tenantId: string;
  sessionId: string | null;
  scopes: string[];
}

export async function authenticateApiKey(req: Request): Promise<ApiKeyActor | null> {
  const presented = req.headers.get("x-api-key");
  if (!presented) return null;

  const record = await db.apiKey.findUnique({
    where: { hashedKey: hashApiKey(presented) },
  });
  if (!record || record.deletedAt) return null;
  if (!verifyApiKey(presented, record.hashedKey)) return null;

  void db.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    keyId: record.id,
    tenantId: record.tenantId,
    sessionId: record.sessionId,
    scopes: record.scopes,
  };
}

export function hasScope(actor: ApiKeyActor, scope: string): boolean {
  return actor.scopes.includes(scope);
}
