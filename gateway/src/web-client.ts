// Client for the web service internal API.
//
// The gateway, on an inbound AUTO message, asks the web app to generate (and
// send) an AI reply via POST /api/internal/generate-reply. That route is built
// in M3 — here we only define the call. The web side guards it with the shared
// INTERNAL_GATEWAY_SECRET (constant-time Bearer compare).
//
// This MUST NEVER throw up into open-wa's onMessage callback: a failed reply
// request should never crash the engine or drop the inbound message (which is
// already persisted). All errors are caught and logged.

const WEB_INTERNAL_URL = process.env.WEB_INTERNAL_URL ?? "http://openwa-web:3000";
const INTERNAL_GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? "";
const REQUEST_TIMEOUT_MS = Number(process.env.WEB_REQUEST_TIMEOUT_MS ?? 15000);

/**
 * Ask the web app to generate (and, in AUTO mode, send) a reply for a
 * conversation. Best-effort: returns true on HTTP 2xx, false otherwise.
 */
export async function requestReply(conversationId: string): Promise<boolean> {
  const url = `${WEB_INTERNAL_URL}/api/internal/generate-reply`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INTERNAL_GATEWAY_SECRET}`,
      },
      body: JSON.stringify({ conversationId }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(
        `[web-client] generate-reply failed: ${res.status} ${res.statusText} (conversation=${conversationId})`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[web-client] generate-reply request error (conversation=${conversationId}):`,
      err
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}
