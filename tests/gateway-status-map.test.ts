import { describe, it, expect } from "vitest";
import { mapGatewayStatus } from "../src/lib/wa/gateway-client";

// Shared mapper used by BOTH the webhook handler and the QR poll-fallback
// route (src/app/api/sessions/[id]/qr/route.ts) — regression coverage for
// the statuses the QR route used to drop (connected/qr/logged_out), which
// left the DB stale when a webhook was missed.
describe("mapGatewayStatus", () => {
  it("maps ready and connected to CONNECTED", () => {
    expect(mapGatewayStatus("ready")).toBe("CONNECTED");
    expect(mapGatewayStatus("connected")).toBe("CONNECTED");
  });

  it("maps qr_ready and qr to QR", () => {
    expect(mapGatewayStatus("qr_ready")).toBe("QR");
    expect(mapGatewayStatus("qr")).toBe("QR");
  });

  it("maps disconnected, logged_out and failed to OFFLINE", () => {
    expect(mapGatewayStatus("disconnected")).toBe("OFFLINE");
    expect(mapGatewayStatus("logged_out")).toBe("OFFLINE");
    expect(mapGatewayStatus("failed")).toBe("OFFLINE");
  });

  it("returns null for transient/unknown statuses (keep current status)", () => {
    expect(mapGatewayStatus("initializing")).toBeNull();
    expect(mapGatewayStatus("authenticating")).toBeNull();
    expect(mapGatewayStatus("something_unknown")).toBeNull();
  });
});
