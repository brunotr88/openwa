/**
 * Typed server-only client for the OpenWA gateway (rmyndharis/OpenWA fork).
 * Auth: X-API-Key header. Base URL + key from env — throws if missing.
 *
 * Gateway contracts (verified in fork source, src/modules):
 * - POST   /api/sessions {name}                          → session
 * - POST   /api/sessions/{id}/start | /stop              → session
 * - DELETE /api/sessions/{id}
 * - GET    /api/sessions | /api/sessions/{id}            → session(s)
 * - GET    /api/sessions/{id}/qr                         → { qrCode, status }
 * - POST   /api/sessions/{id}/messages/send-text         → { messageId, timestamp }
 *          body: { chatId: "39333...@c.us", text }
 * - POST   /api/sessions/{id}/webhooks                   → webhook
 *          body: { url, events, secret?, headers?, retryCount? }
 * - GET    /api/sessions/{id}/contacts/{contactId}       → contact
 *          contactId MUST include its suffix (e.g. "1273...@lid" / "39...@c.us")
 *          → { id:"39...@c.us", pushName, number, isMyContact, isBlocked }
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/** Gateway session status values (fork: EngineStatus / SessionStatus). */
export type GatewaySessionStatus =
  | "disconnected"
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "failed"
  | string;

export interface GatewaySession {
  id: string;
  name: string;
  status: GatewaySessionStatus;
  phone?: string | null;
  pushName?: string | null;
  connectedAt?: string | null;
  lastActive?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface GatewayQrResponse {
  qrCode: string; // data:image/png;base64,...
  status: GatewaySessionStatus;
}

export interface GatewaySendResult {
  messageId: string;
  timestamp: number;
}

export interface GatewayWebhook {
  id: string;
  sessionId: string;
  url: string;
  events: string[];
  active: boolean;
}

/**
 * Contact as returned by GET /api/sessions/{id}/contacts/{contactId}.
 * - `id`     = real phone number in `<number>@c.us` form (the actual phone).
 * - `pushName` = the contact's display name.
 * - `number` = the @lid digits (NOT a real number — ignore for display).
 */
export interface GatewayContact {
  id?: string;
  pushName?: string;
  number?: string;
  isMyContact?: boolean;
  isBlocked?: boolean;
}

/** Typed error for any non-2xx gateway response or network/timeout failure. */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

function gatewayConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.GATEWAY_URL;
  const apiKey = process.env.GATEWAY_API_KEY;
  if (!baseUrl) throw new GatewayError("GATEWAY_URL environment variable is required");
  if (!apiKey) throw new GatewayError("GATEWAY_API_KEY environment variable is required");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

async function gwFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const { baseUrl, apiKey } = gatewayConfig();
  const { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS } = init;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "X-API-Key": apiKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new GatewayError(
      `Gateway unreachable (${method} ${path}): ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GatewayError(
      `Gateway error ${res.status} (${method} ${path})`,
      res.status,
      text.slice(0, 500)
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Create a gateway session. Name: 3-50 chars, [a-zA-Z0-9-] only. */
export async function createSession(name: string): Promise<GatewaySession> {
  return gwFetch<GatewaySession>("/api/sessions", { method: "POST", body: { name } });
}

export async function startSession(gwId: string): Promise<GatewaySession> {
  // Engine init can take a while (puppeteer launch) — allow a longer timeout.
  return gwFetch<GatewaySession>(`/api/sessions/${gwId}/start`, {
    method: "POST",
    timeoutMs: 60_000,
  });
}

export async function stopSession(gwId: string): Promise<GatewaySession> {
  return gwFetch<GatewaySession>(`/api/sessions/${gwId}/stop`, {
    method: "POST",
    timeoutMs: 30_000,
  });
}

export async function deleteSession(gwId: string): Promise<void> {
  await gwFetch<unknown>(`/api/sessions/${gwId}`, { method: "DELETE", timeoutMs: 30_000 });
}

export async function getSession(gwId: string): Promise<GatewaySession> {
  return gwFetch<GatewaySession>(`/api/sessions/${gwId}`);
}

export async function listSessions(): Promise<GatewaySession[]> {
  return gwFetch<GatewaySession[]>("/api/sessions");
}

export async function getQr(gwId: string): Promise<GatewayQrResponse> {
  return gwFetch<GatewayQrResponse>(`/api/sessions/${gwId}/qr`);
}

/**
 * Send a text message. `to` may be a bare phone number ("393331234567")
 * or a full chat id ("393331234567@c.us") — bare numbers are normalized.
 */
export async function sendText(
  gwId: string,
  to: string,
  text: string
): Promise<GatewaySendResult> {
  const chatId = to.includes("@") ? to : `${to.replace(/^\+/, "")}@c.us`;
  return gwFetch<GatewaySendResult>(`/api/sessions/${gwId}/messages/send-text`, {
    method: "POST",
    body: { chatId, text },
    timeoutMs: 30_000,
  });
}

/**
 * Resolve a contact's real name + phone via the gateway.
 *
 * `contactId` MUST include its original WhatsApp suffix
 * (e.g. "127345813942417@lid" or "393478435299@c.us"); calling without a
 * suffix returns HTTP 500 from the gateway. Resolution may legitimately fail
 * for privacy-restricted contacts — this never throws and returns `null` on
 * any error, non-200, missing config, or timeout, so callers (webhook,
 * backfill) can keep their existing fallback behaviour.
 */
export async function getContact(
  gatewaySessionId: string,
  contactId: string,
  timeoutMs = 8_000
): Promise<GatewayContact | null> {
  try {
    const data = await gwFetch<GatewayContact>(
      `/api/sessions/${gatewaySessionId}/contacts/${encodeURIComponent(contactId)}`,
      { timeoutMs }
    );
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Register a webhook for a session. The secret is provided by the caller
 * (gateway stores it and signs deliveries with HMAC-SHA256, header
 * X-OpenWA-Signature: "sha256=<hex>").
 */
export async function registerWebhook(
  gwId: string,
  url: string,
  events: string[],
  secret?: string
): Promise<GatewayWebhook> {
  return gwFetch<GatewayWebhook>(`/api/sessions/${gwId}/webhooks`, {
    method: "POST",
    body: { url, events, ...(secret ? { secret } : {}) },
  });
}
