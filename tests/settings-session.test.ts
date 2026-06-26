import { describe, it, expect } from "vitest";
import { parseSettingsWithFallback } from "@/lib/settings/session";

describe("parseSettingsWithFallback", () => {
  it("usa i settings della sessione se presenti", () => {
    const out = parseSettingsWithFallback(
      { persona: { botName: "BotSessione" } },
      { persona: { botName: "BotTenant" } }
    );
    expect(out.persona.botName).toBe("BotSessione");
  });
  it("fa fallback ai settings del tenant se la sessione è null", () => {
    const out = parseSettingsWithFallback(null, { persona: { botName: "BotTenant" } });
    expect(out.persona.botName).toBe("BotTenant");
  });
  it("usa i default se entrambi null (campi sempre valorizzati)", () => {
    const out = parseSettingsWithFallback(null, null);
    expect(out.behavior.aiMode).toBe("COPILOT"); // default da schema
    expect(out.sending.businessHoursOnlyOutbound).toBe(true);
  });
});
