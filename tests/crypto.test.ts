import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptString,
  decryptString,
  _resetKeyCache,
} from "../src/lib/crypto";

// 32-byte key as 64 hex chars.
const TEST_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

describe("crypto AES-256-GCM", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    _resetKeyCache();
  });

  it("round-trips a plaintext string", () => {
    const plain = "wa-session-token:abc123!@#";
    const enc = encryptString(plain);
    expect(enc).not.toBeNull();
    expect(enc).not.toBe(plain);
    expect(decryptString(enc)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptString("same");
    const b = encryptString("same");
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe("same");
    expect(decryptString(b)).toBe("same");
  });

  it("passes null through unchanged", () => {
    expect(encryptString(null)).toBeNull();
    expect(decryptString(null)).toBeNull();
  });

  it("throws on a tampered ciphertext (auth tag mismatch)", () => {
    const enc = encryptString("secret")!;
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a byte in the ciphertext
    expect(() => decryptString(buf.toString("base64"))).toThrow();
  });

  it("throws when ENCRYPTION_KEY is invalid (no fallback)", () => {
    process.env.ENCRYPTION_KEY = "too-short";
    _resetKeyCache();
    expect(() => encryptString("x")).toThrow();
  });
});
