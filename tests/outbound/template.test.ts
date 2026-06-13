import { describe, it, expect } from "vitest";
import { extractVariables, renderTemplate } from "@/lib/outbound/template";

describe("extractVariables", () => {
  it("estrae nomi unici tra doppie graffe", () => {
    expect(extractVariables("Ciao {{nome}}, il tuo {{prodotto}} ({{nome}}) è pronto")).toEqual([
      "nome",
      "prodotto",
    ]);
  });
  it("tollera spazi interni", () => {
    expect(extractVariables("{{ nome }} e {{cognome}}")).toEqual(["nome", "cognome"]);
  });
  it("nessun placeholder → array vuoto", () => {
    expect(extractVariables("nessuna variabile")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("sostituisce i placeholder noti", () => {
    expect(renderTemplate("Ciao {{nome}}", { nome: "Bruno" })).toBe("Ciao Bruno");
  });
  it("lancia se manca una variabile richiesta", () => {
    expect(() => renderTemplate("Ciao {{nome}}", {})).toThrow(/nome/);
  });
  it("sostituisce tutte le occorrenze", () => {
    expect(renderTemplate("{{x}}-{{x}}", { x: "a" })).toBe("a-a");
  });
});
