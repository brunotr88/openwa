import { describe, it, expect } from "vitest";
import {
  hasAiDisclosure,
  applyAiDisclosure,
  disclosureLine,
} from "../src/lib/wa/ai-disclosure";

// Trasparenza AI Act Art. 50(1)+(5): l'utente deve sapere che sta parlando con
// un'IA, in modo chiaro e distinguibile, al più tardi alla prima interazione.

describe("hasAiDisclosure", () => {
  it("riconosce le formulazioni con cui il modello si presenta già come IA", () => {
    for (const t of [
      "Ciao! Sono l'assistente virtuale di ISIPC, dimmi pure.",
      "Sono un assistente digitale, ti aiuto io.",
      "Ti risponde un chatbot dello studio.",
      "Sono un'intelligenza artificiale, non una persona.",
      "Attenzione: non sono una persona, ma posso aiutarti.",
    ]) {
      expect(hasAiDisclosure(t), t).toBe(true);
    }
  });

  it("NON considera disclosure un testo che parla d'altro", () => {
    for (const t of [
      "Ciao Bruno, il PC non si accende? Proviamo in remoto.",
      "Ti confermo l'appuntamento per giovedì alle 16.",
      "Sono Bruno, ti richiamo tra poco.", // impersonare NON è disclosure
    ]) {
      expect(hasAiDisclosure(t), t).toBe(false);
    }
  });
});

describe("applyAiDisclosure", () => {
  it("aggiunge la disclosure quando manca, separata e distinguibile", () => {
    const out = applyAiDisclosure("Ciao! Il PC non si accende?", {
      businessName: "ISIPC",
    });
    expect(hasAiDisclosure(out)).toBe(true);
    expect(out).toContain("Ciao! Il PC non si accende?");
    // Art. 50(5): chiara e distinguibile → riga separata, non incastrata nel corpo.
    expect(out).toContain("\n\n");
    expect(out).toContain("ISIPC");
  });

  it("è idempotente: non raddoppia se il modello si è già presentato", () => {
    const already = "Ciao, sono l'assistente virtuale di ISIPC. Dimmi pure.";
    expect(applyAiDisclosure(already, { businessName: "ISIPC" })).toBe(already);
    // e applicarla due volte non cambia nulla
    const once = applyAiDisclosure("Ciao!", { businessName: "ISIPC" });
    expect(applyAiDisclosure(once, { businessName: "ISIPC" })).toBe(once);
  });

  it("funziona anche senza nome attività configurato", () => {
    const out = applyAiDisclosure("Ciao!", { businessName: "" });
    expect(hasAiDisclosure(out)).toBe(true);
    expect(out).toContain("assistente virtuale (IA)");
  });

  it("offre sempre l'alternativa umana", () => {
    expect(disclosureLine("ISIPC")).toMatch(/persona/i);
  });

  it("non tocca un testo vuoto", () => {
    expect(applyAiDisclosure("   ", {})).toBe("");
  });
});
