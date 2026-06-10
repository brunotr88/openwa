import { describe, it, expect } from "vitest";
import {
  realPhoneFromGatewayId,
  mapGatewayContact,
  resolutionPatch,
  formatPhone,
  contactDisplayName,
  contactPhoneLine,
  candidateContactIds,
} from "../src/lib/wa/contact-resolve";

describe("realPhoneFromGatewayId", () => {
  it("extracts digits before @c.us", () => {
    expect(realPhoneFromGatewayId("393478435299@c.us")).toBe("393478435299");
  });
  it("returns undefined for @lid ids (not a real number)", () => {
    expect(realPhoneFromGatewayId("127345813942417@lid")).toBeUndefined();
  });
  it("returns undefined for missing/empty id", () => {
    expect(realPhoneFromGatewayId(undefined)).toBeUndefined();
    expect(realPhoneFromGatewayId(null)).toBeUndefined();
    expect(realPhoneFromGatewayId("")).toBeUndefined();
  });
  it("returns undefined when the prefix isn't digits", () => {
    expect(realPhoneFromGatewayId("abc@c.us")).toBeUndefined();
  });
});

describe("mapGatewayContact", () => {
  it("maps pushName→name and id→phone (the gateway contract)", () => {
    expect(
      mapGatewayContact({
        id: "393478435299@c.us",
        pushName: "Enrico Zaratin",
        number: "127345813942417",
      })
    ).toEqual({ name: "Enrico Zaratin", phone: "393478435299" });
  });
  it("ignores the @lid `number` field and blank pushName", () => {
    expect(
      mapGatewayContact({ id: "127345813942417@lid", pushName: "  ", number: "127345813942417" })
    ).toEqual({});
  });
  it("returns {} for null contact", () => {
    expect(mapGatewayContact(null)).toEqual({});
  });
});

describe("resolutionPatch", () => {
  it("sets fields when currently empty", () => {
    expect(
      resolutionPatch({ name: "Bruno", phone: "393331112233" }, { name: null, phone: null })
    ).toEqual({ name: "Bruno", phone: "393331112233" });
  });
  it("skips fields that are unchanged", () => {
    expect(
      resolutionPatch({ name: "Bruno", phone: "393331112233" }, { name: "Bruno", phone: "393331112233" })
    ).toEqual({});
  });
  it("overwrites changed fields", () => {
    expect(
      resolutionPatch({ name: "Nuovo" }, { name: "Vecchio", phone: "393331112233" })
    ).toEqual({ name: "Nuovo" });
  });
  it("does not unset on empty resolution", () => {
    expect(resolutionPatch({}, { name: "Bruno", phone: "393331112233" })).toEqual({});
  });
});

describe("formatPhone", () => {
  it("formats Italian mobile as +39 347 843 5299", () => {
    expect(formatPhone("393478435299")).toBe("+39 347 843 5299");
  });
  it("groups short Italian numbers gracefully", () => {
    expect(formatPhone("3934784")).toBe("+39 347 84");
  });
  it("prefixes + for non-Italian numbers", () => {
    expect(formatPhone("14155552671")).toBe("+14155552671");
  });
  it("strips non-digits", () => {
    expect(formatPhone("+39 347-843-5299")).toBe("+39 347 843 5299");
  });
});

describe("contactDisplayName / contactPhoneLine", () => {
  it("prefers name, then phone, then raw waId", () => {
    expect(contactDisplayName({ name: "Enrico", phone: "393478435299", waId: "127345" })).toBe("Enrico");
    expect(contactDisplayName({ name: null, phone: "393478435299", waId: "127345" })).toBe("+39 347 843 5299");
    expect(contactDisplayName({ name: null, phone: null, waId: "127345813942417" })).toBe("+127345813942417");
  });
  it("never shows raw @lid digits when a name exists but no real phone", () => {
    expect(contactPhoneLine({ name: "Enrico", phone: null, waId: "127345813942417" })).toBeNull();
  });
  it("shows the formatted real phone when known", () => {
    expect(contactPhoneLine({ name: "Enrico", phone: "393478435299", waId: "127345" })).toBe("+39 347 843 5299");
  });
  it("falls back to raw waId only when neither name nor phone", () => {
    expect(contactPhoneLine({ name: null, phone: null, waId: "127345813942417" })).toBe("+127345813942417");
  });
});

describe("candidateContactIds", () => {
  it("tries @lid first for long privacy ids", () => {
    expect(candidateContactIds("127345813942417")).toEqual([
      "127345813942417@lid",
      "127345813942417@c.us",
    ]);
  });
  it("tries @c.us first for phone-like ids", () => {
    expect(candidateContactIds("393478435299")).toEqual([
      "393478435299@c.us",
      "393478435299@lid",
    ]);
  });
  it("returns [] for ids that already carry a suffix (groups)", () => {
    expect(candidateContactIds("12345-67890@g.us")).toEqual([]);
  });
});
