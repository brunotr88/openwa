/**
 * API key per l'API privata (spec §10): si conserva solo lo SHA-256 del
 * plaintext (lookup per uguaglianza sull'hash di un segreto ad alta entropia)
 * + un prefisso per display. Confronto finale con timingSafeEqual.
 */
import { randomBytes, createHash, timingSafeEqual } from "crypto";

export interface GeneratedApiKey {
  plaintext: string; // mostrato UNA volta
  prefix: string;    // primi 12 char, salvati per display
  hashedKey: string; // sha256 hex, salvato e indicizzato
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(24).toString("base64url"); // 32 char url-safe
  const plaintext = `owa_live_${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 12),
    hashedKey: hashApiKey(plaintext),
  };
}

export function verifyApiKey(plaintext: string, hashedKey: string): boolean {
  const a = Buffer.from(hashApiKey(plaintext), "hex");
  const b = Buffer.from(hashedKey, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
