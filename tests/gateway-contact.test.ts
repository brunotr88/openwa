import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getContact } from "../src/lib/wa/gateway-client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.GATEWAY_URL = "https://gw.example.com";
  process.env.GATEWAY_API_KEY = "k";
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("getContact", () => {
  it("returns the mapped gateway contact on 200", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "393478435299@c.us",
        pushName: "Enrico Zaratin",
        number: "127345813942417",
        isMyContact: false,
        isBlocked: false,
      })
    );
    const c = await getContact("gw-uuid", "127345813942417@lid");
    expect(c).toMatchObject({ id: "393478435299@c.us", pushName: "Enrico Zaratin" });

    // contactId is sent WITH its suffix, URL-encoded into the path.
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain(
      "/api/sessions/gw-uuid/contacts/127345813942417%40lid"
    );
  });

  it("returns null on a non-200 (e.g. privacy 500) instead of throwing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, 500));
    await expect(getContact("gw-uuid", "x@lid")).resolves.toBeNull();
  });

  it("returns null on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(getContact("gw-uuid", "x@lid")).resolves.toBeNull();
  });

  it("returns null when gateway config is missing", async () => {
    delete process.env.GATEWAY_URL;
    await expect(getContact("gw-uuid", "x@lid")).resolves.toBeNull();
  });
});
