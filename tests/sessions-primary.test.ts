import { describe, it, expect } from "vitest";
import { pickPrimarySession } from "@/lib/sessions/primary";

const s = (id: string, status: string, iso: string) => ({ id, status, createdAt: new Date(iso) });

describe("pickPrimarySession", () => {
  it("ritorna null se nessuna sessione", () => {
    expect(pickPrimarySession([])).toBeNull();
  });
  it("preferisce la CONNECTED più recente", () => {
    const out = pickPrimarySession([
      s("a", "OFFLINE", "2026-06-10T00:00:00Z"),
      s("b", "CONNECTED", "2026-06-11T00:00:00Z"),
      s("c", "CONNECTED", "2026-06-12T00:00:00Z"),
    ]);
    expect(out).toBe("c");
  });
  it("senza CONNECTED, ritorna la più recente in assoluto", () => {
    const out = pickPrimarySession([
      s("a", "OFFLINE", "2026-06-10T00:00:00Z"),
      s("b", "QR", "2026-06-12T00:00:00Z"),
    ]);
    expect(out).toBe("b");
  });
});
