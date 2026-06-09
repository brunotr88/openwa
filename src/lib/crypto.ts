/**
 * AES-256-GCM at-rest encryption.
 * Blueprint §3 — NO SHA-256 fallback, throw on bad key.
 * Key: 64 hex chars or 44 base64 chars (32 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm" as const;
const IV_LEN = 12; // 96 bit GCM recommended
const TAG_LEN = 16;

let _key: Buffer | undefined;

function loadKey(): Buffer {
  if (_key) return _key;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, "hex");
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(raw) || /^[A-Za-z0-9+/]{44}$/.test(raw)) {
    buf = Buffer.from(raw, "base64");
  } else {
    throw new Error(
      "ENCRYPTION_KEY must be 64 hex chars or 44 base64 chars (32 bytes). No fallback."
    );
  }

  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY decoded to ${buf.length} bytes, expected 32. No fallback.`
    );
  }

  _key = buf;
  return _key;
}

/** Encrypt a plaintext string → base64(IV || AuthTag || Ciphertext) */
export function encryptString(plain: string | null): string | null {
  if (plain === null || plain === undefined) return null;

  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt base64(IV || AuthTag || Ciphertext) → plaintext string */
export function decryptString(ciphertext: string | null): string | null {
  if (ciphertext === null || ciphertext === undefined) return null;

  const key = loadKey();
  const buf = Buffer.from(ciphertext, "base64");

  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("Ciphertext too short — corrupted data");
  }

  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

// Reset cached key — useful in tests when env changes
export function _resetKeyCache(): void {
  _key = undefined;
}
