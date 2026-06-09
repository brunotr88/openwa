// WaEngine — abstract WhatsApp engine interface (spec §5).
// Fase 1 impl: OpenWaEngine (open-wa/wa-automate). Future: CloudApiEngine.
// Keeping this a pure interface lets us swap to the official WhatsApp Cloud API
// without touching the application logic (inbound/outbound).

/** Session lifecycle status, mirrors WaSessionStatus in the Prisma schema. */
export type WaStatus = "QR" | "CONNECTED" | "BANNED" | "OFFLINE";

/** Reference to a media payload to send (Fase 1: url or base64 data). */
export interface MediaRef {
  /** Public/remote URL of the media, if available. */
  url?: string;
  /** Base64-encoded data URI (e.g. "data:image/png;base64,...."), if inlined. */
  dataUrl?: string;
  /** Optional filename hint. */
  filename?: string;
  /** Optional caption to attach to the media message. */
  caption?: string;
}

/** Normalised inbound message handed to the application inbound handler. */
export interface InboundMsg {
  /** WaSession id this message arrived on. */
  sessionId: string;
  /** Tenant that owns the session (resolved from WaSession). */
  tenantId: string;
  /** WhatsApp id of the remote contact (e.g. "39333...@c.us"). */
  waId: string;
  /** Best-effort display name of the contact, if WhatsApp exposes one. */
  contactName?: string;
  /** Text body of the message (undefined for pure-media messages). */
  body?: string;
  /** Media reference if the message carried an attachment. */
  media?: MediaRef;
  /** Engine-native message id, useful for dedup/idempotency. */
  externalId?: string;
  /** Epoch millis the message was received. */
  timestamp: number;
}

export interface WaEngine {
  /** Start (or resume) a session; returns the QR to scan if pairing is needed. */
  startSession(sessionId: string): Promise<{ qr?: string; status: WaStatus }>;
  /** Stop a running session and release its Chromium client. */
  stopSession(sessionId: string): Promise<void>;
  /** Send a plain text message; returns the engine ack. */
  sendText(sessionId: string, waId: string, text: string): Promise<{ ack: string }>;
  /** Send a media message; returns the engine ack. */
  sendMedia(sessionId: string, waId: string, media: MediaRef): Promise<{ ack: string }>;
  /** Register the inbound message handler (invoked for every received message). */
  onMessage(handler: (msg: InboundMsg) => Promise<void>): void;
  /** Register a session status-change listener. */
  onStatusChange(handler: (sessionId: string, status: WaStatus) => void): void;
}
