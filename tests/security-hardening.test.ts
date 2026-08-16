import { describe, it, expect } from "vitest";
import { redactError } from "../src/lib/outbound/worker";

// Hardening post-incidente AWS del 13/08/2026 (chiave bedrock-invoker compromessa).
// OutboundJob.lastError è leggibile via GET /api/v1/messages/[id]: qualunque cosa
// finisca lì esce da un endpoint API, quindi non deve contenere credenziali.

describe("redactError", () => {
  it("redige l'access key id AWS dagli errori di firma SigV4", () => {
    const sigv4 =
      "Credential should be scoped to a valid region. " +
      "Credential=AKIAYMA3D27KASYPQFX5/20260816/eu-central-1/bedrock/aws4_request, " +
      "Signature=9f1c2b7a4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70";
    const out = redactError(sigv4);
    expect(out).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(out).not.toContain("AKIAYMA3D27KASYPQFX5");
    expect(out).toContain("REDACTED");
    // il resto del messaggio resta diagnosticabile
    expect(out).toContain("valid region");
  });

  it("redige le credenziali temporanee ASIA...", () => {
    expect(redactError("token ASIAYMA3D27KASYPQFX5 expired")).not.toContain(
      "ASIAYMA3D27KASYPQFX5"
    );
  });

  it("redige la API key del gateway e i bearer token", () => {
    const out = redactError(
      "401 from gateway (key owa_k1_2ad4a26f7ff736d4546e0e7d9c8ac9d8) / Bearer abcdef1234567890"
    );
    expect(out).not.toContain("owa_k1_2ad4a26f7ff736d4546e0e7d9c8ac9d8");
    expect(out).not.toContain("abcdef1234567890");
  });

  it("lascia intatti gli errori ordinari (niente falsi positivi)", () => {
    for (const msg of [
      "session has no gateway ref",
      "contact 123 has no sendable chat id",
      "Gateway error 500 (POST /api/sessions/x/messages/send-text)",
      "stuck_in_sending",
    ]) {
      expect(redactError(msg), msg).toBe(msg);
    }
  });
});
