import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKey } from "@/lib/apikey";

describe("apikey", () => {
  it("genera key con prefisso owa_live_ e hash coerente", () => {
    const k = generateApiKey();
    expect(k.plaintext).toMatch(/^owa_live_[A-Za-z0-9_-]{32,}$/);
    expect(k.prefix).toBe(k.plaintext.slice(0, 12));
    expect(k.hashedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(k.hashedKey).toBe(hashApiKey(k.plaintext));
  });

  it("genera key uniche", () => {
    expect(generateApiKey().plaintext).not.toBe(generateApiKey().plaintext);
  });

  it("verifyApiKey true solo per il plaintext corretto", () => {
    const k = generateApiKey();
    expect(verifyApiKey(k.plaintext, k.hashedKey)).toBe(true);
    expect(verifyApiKey("owa_live_sbagliata", k.hashedKey)).toBe(false);
  });

  it("verifyApiKey non lancia su lunghezze diverse", () => {
    const k = generateApiKey();
    expect(verifyApiKey("corta", k.hashedKey)).toBe(false);
  });
});
