// BaileysEngine — WaEngine implementation backed by @whiskeysockets/baileys.
//
// One Baileys WebSocket per WaSession. No Chromium: Baileys speaks the
// WhatsApp Web multi-device protocol directly over a WebSocket. Sessions are
// created lazily (on startSession) and the socket is kept alive; auth creds are
// persisted per-session under SESSIONS_DIR via useMultiFileAuthState so they
// survive process restarts (the dir is a persistent volume in Docker).
//
// A dying session must NEVER crash the process: every event handler is wrapped
// in try/catch and logged with the [baileys] prefix. Errors never propagate out
// of the socket's event callbacks.
//
// API surface used (Baileys v6.x — verified against the installed package):
//   - makeWASocket(config): WASocket          (both default and named export)
//   - useMultiFileAuthState(folder): { state, saveCreds }
//   - DisconnectReason (enum of statusCodes), Browsers (browser descriptors)
//   - fetchLatestBaileysVersion(): { version } — pinned to the WA Web build
//   - sock.ev.on('creds.update' | 'connection.update' | 'messages.upsert', cb)
//   - sock.sendMessage(jid, { text }) ; sock.logout() ; sock.end(err)
//
// connection.update delivers: { connection?: 'open'|'connecting'|'close',
//   qr?: string, lastDisconnect?: { error } }. The QR is a raw string we both
//   store verbatim AND render to a PNG data URL via qrcode.toDataURL.

import { join } from "node:path";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
  type WAMessage,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import type { WaEngine, WaStatus, InboundMsg, MediaRef } from "./engine";
import { db } from "./db";

type InboundHandler = (msg: InboundMsg) => Promise<void>;
type StatusHandler = (sessionId: string, status: WaStatus) => void;

const SESSIONS_DIR = process.env.SESSIONS_DIR ?? "/app/sessions";

// Suffix WhatsApp uses for individual-user JIDs on the multi-device protocol.
const USER_JID_SUFFIX = "@s.whatsapp.net";

/** Strip the @s.whatsapp.net (or legacy @c.us) suffix from a remoteJid. */
function stripJidSuffix(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "");
}

export class BaileysEngine implements WaEngine {
  private sockets = new Map<string, WASocket>();
  private starting = new Map<string, Promise<{ qr?: string; status: WaStatus }>>();
  // Raw QR string (what open-wa exposed) keyed by sessionId.
  private qrCodes = new Map<string, string>();
  // PNG data URL rendered from the raw QR, for clients that want an <img>.
  private qrDataUrls = new Map<string, string>();
  private statuses = new Map<string, WaStatus>();
  // Sessions explicitly logged out — must NOT auto-reconnect.
  private loggedOut = new Set<string>();
  private inboundHandler?: InboundHandler;
  private statusHandler?: StatusHandler;

  onMessage(handler: InboundHandler): void {
    this.inboundHandler = handler;
  }

  onStatusChange(handler: StatusHandler): void {
    this.statusHandler = handler;
  }

  private setStatus(sessionId: string, status: WaStatus): void {
    this.statuses.set(sessionId, status);
    if (status === "CONNECTED") {
      this.qrCodes.delete(sessionId);
      this.qrDataUrls.delete(sessionId);
    }
    try {
      this.statusHandler?.(sessionId, status);
    } catch (err) {
      console.error(`[baileys] statusHandler threw for ${sessionId}:`, err);
    }
  }

  async startSession(sessionId: string): Promise<{ qr?: string; status: WaStatus }> {
    // Already live → report current state + any pending QR (idempotent).
    if (this.sockets.has(sessionId)) {
      return {
        qr: this.qrCodes.get(sessionId),
        status: this.statuses.get(sessionId) ?? "CONNECTED",
      };
    }

    // Coalesce concurrent starts for the same session.
    const inFlight = this.starting.get(sessionId);
    if (inFlight) return inFlight;

    const promise = this.launch(sessionId).finally(() => {
      this.starting.delete(sessionId);
    });
    this.starting.set(sessionId, promise);
    return promise;
  }

  /**
   * Create the socket and wire its events. Returns once the socket object
   * exists (connection happens asynchronously via connection.update). We do NOT
   * block waiting for 'open' — the HTTP contract just needs the current
   * status/QR, which the QR handler fills in shortly after.
   */
  private async launch(sessionId: string): Promise<{ qr?: string; status: WaStatus }> {
    try {
      this.loggedOut.delete(sessionId);

      const { state, saveCreds } = await useMultiFileAuthState(
        join(SESSIONS_DIR, sessionId)
      );

      // Pin to the latest WA Web build for resilience; fall back gracefully.
      let version: [number, number, number] | undefined;
      try {
        ({ version } = await fetchLatestBaileysVersion());
      } catch (err) {
        console.error(`[baileys] fetchLatestBaileysVersion failed for ${sessionId}:`, err);
      }

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.appropriate("Chrome"),
        ...(version ? { version } : {}),
      });

      this.sockets.set(sessionId, sock);
      // Default to OFFLINE until the connection opens or a QR is emitted.
      if (!this.statuses.has(sessionId)) this.setStatus(sessionId, "OFFLINE");

      sock.ev.on("creds.update", saveCreds);
      this.wireConnection(sessionId, sock);
      this.wireMessages(sessionId, sock);

      return {
        qr: this.qrCodes.get(sessionId),
        status: this.statuses.get(sessionId) ?? "OFFLINE",
      };
    } catch (err) {
      console.error(`[baileys] failed to start session ${sessionId}:`, err);
      this.sockets.delete(sessionId);
      this.setStatus(sessionId, "OFFLINE");
      return { qr: this.qrCodes.get(sessionId), status: "OFFLINE" };
    }
  }

  private wireConnection(sessionId: string, sock: WASocket): void {
    sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      try {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCodes.set(sessionId, qr);
          // Render a PNG data URL too; best-effort, never fatal.
          QRCode.toDataURL(qr)
            .then((dataUrl) => this.qrDataUrls.set(sessionId, dataUrl))
            .catch((err) =>
              console.error(`[baileys] QR dataURL render failed for ${sessionId}:`, err)
            );
          this.setStatus(sessionId, "QR");
        }

        if (connection === "open") {
          this.setStatus(sessionId, "CONNECTED");
        } else if (connection === "close") {
          this.handleClose(sessionId, lastDisconnect);
        }
      } catch (err) {
        console.error(`[baileys] connection.update handler failed for ${sessionId}:`, err);
      }
    });
  }

  /**
   * Decide what to do when the socket closes. On loggedOut → OFFLINE, no
   * reconnect (creds are stale; the user must re-pair). Otherwise → recreate
   * the socket to reconnect. We drop the dead socket from the map first so
   * launch() doesn't short-circuit on the "already live" check.
   */
  private handleClose(
    sessionId: string,
    lastDisconnect: ConnectionState["lastDisconnect"]
  ): void {
    this.sockets.delete(sessionId);

    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    const isLoggedOut = statusCode === DisconnectReason.loggedOut;

    if (isLoggedOut || this.loggedOut.has(sessionId)) {
      // Stale session: do not auto-reconnect (would loop forever on bad creds).
      this.loggedOut.add(sessionId);
      this.setStatus(sessionId, "OFFLINE");
      return;
    }

    // Transient close → reconnect by recreating the socket. launch() is only
    // re-entered on the close event (not on a timer), so this is naturally
    // rate-limited by WhatsApp's own connection lifecycle — no tight loop.
    this.setStatus(sessionId, "OFFLINE");
    this.launch(sessionId).catch((err) =>
      console.error(`[baileys] reconnect failed for ${sessionId}:`, err)
    );
  }

  private wireMessages(sessionId: string, sock: WASocket): void {
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      // 'notify' = freshly received while online. Ignore history/append syncs.
      if (type !== "notify") return;
      for (const message of messages) {
        try {
          await this.handleInboundMessage(sessionId, message);
        } catch (err) {
          // A single bad message must never crash the socket.
          console.error(`[baileys] inbound handling failed for ${sessionId}:`, err);
        }
      }
    });
  }

  private async handleInboundMessage(sessionId: string, message: WAMessage): Promise<void> {
    if (!this.inboundHandler) return;
    // Ignore our own outgoing echoes.
    if (message.key?.fromMe) return;

    const remoteJid = message.key?.remoteJid;
    if (!remoteJid) return;
    // Skip groups/status/broadcast — Fase 1 handles 1:1 user chats only.
    if (!remoteJid.endsWith(USER_JID_SUFFIX) && !remoteJid.endsWith("@c.us")) return;

    const tenantId = await this.resolveTenantId(sessionId);
    if (!tenantId) {
      console.error(`[baileys] no tenant for session ${sessionId}; dropping inbound`);
      return;
    }

    await this.inboundHandler(this.toInboundMsg(sessionId, tenantId, message));
  }

  private async resolveTenantId(sessionId: string): Promise<string | null> {
    try {
      const session = await db.waSession.findUnique({
        where: { id: sessionId },
        select: { tenantId: true },
      });
      return session?.tenantId ?? null;
    } catch (err) {
      console.error(`[baileys] tenant lookup failed for ${sessionId}:`, err);
      return null;
    }
  }

  private toInboundMsg(sessionId: string, tenantId: string, message: WAMessage): InboundMsg {
    const remoteJid = message.key?.remoteJid ?? "";
    const waId = stripJidSuffix(remoteJid);

    const text =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      undefined;
    const body = typeof text === "string" && text.length > 0 ? text : undefined;

    const contactName = message.pushName ?? undefined;

    // messageTimestamp is seconds (number or Long-like); coerce to epoch millis.
    const tsRaw = message.messageTimestamp;
    const tsSeconds =
      typeof tsRaw === "number"
        ? tsRaw
        : tsRaw != null
          ? Number(tsRaw.toString())
          : Date.now() / 1000;

    return {
      sessionId,
      tenantId,
      waId,
      contactName,
      body,
      externalId: message.key?.id ?? undefined,
      timestamp: Math.round(tsSeconds * 1000),
    };
  }

  async stopSession(sessionId: string): Promise<void> {
    const sock = this.sockets.get(sessionId);
    // Mark as logged-out intent so any in-flight close handler won't reconnect.
    this.loggedOut.add(sessionId);
    if (!sock) {
      this.qrCodes.delete(sessionId);
      this.qrDataUrls.delete(sessionId);
      this.setStatus(sessionId, "OFFLINE");
      return;
    }
    try {
      // end() tears down the WebSocket without invalidating creds, so the
      // session can be resumed later from disk. logout() would wipe creds.
      sock.end(undefined);
    } catch (err) {
      console.error(`[baileys] failed to end session ${sessionId}:`, err);
    } finally {
      this.sockets.delete(sessionId);
      this.qrCodes.delete(sessionId);
      this.qrDataUrls.delete(sessionId);
      this.setStatus(sessionId, "OFFLINE");
    }
  }

  async sendText(sessionId: string, waId: string, text: string): Promise<{ ack: string }> {
    const sock = this.sockets.get(sessionId);
    if (!sock) throw new Error(`session ${sessionId} not started`);
    const jid = waId.includes("@") ? waId : `${waId}${USER_JID_SUFFIX}`;
    const sent = await sock.sendMessage(jid, { text });
    return { ack: String(sent?.key?.id ?? "") };
  }

  async sendMedia(sessionId: string, waId: string, media: MediaRef): Promise<{ ack: string }> {
    const sock = this.sockets.get(sessionId);
    if (!sock) throw new Error(`session ${sessionId} not started`);
    const jid = waId.includes("@") ? waId : `${waId}${USER_JID_SUFFIX}`;

    // Best-effort image send: accept a remote URL or a base64 data URL.
    if (media.url) {
      const sent = await sock.sendMessage(jid, {
        image: { url: media.url },
        caption: media.caption,
      });
      return { ack: String(sent?.key?.id ?? "") };
    }
    if (media.dataUrl) {
      const base64 = media.dataUrl.includes(",")
        ? media.dataUrl.slice(media.dataUrl.indexOf(",") + 1)
        : media.dataUrl;
      const sent = await sock.sendMessage(jid, {
        image: Buffer.from(base64, "base64"),
        caption: media.caption,
      });
      return { ack: String(sent?.key?.id ?? "") };
    }
    throw new Error("sendMedia: media requires url or dataUrl");
  }

  /** Expose the stored QR for the HTTP /qr route (raw string + PNG data URL). */
  getQr(sessionId: string): { qr?: string; qrDataUrl?: string; status: WaStatus } {
    return {
      qr: this.qrCodes.get(sessionId),
      qrDataUrl: this.qrDataUrls.get(sessionId),
      status: this.statuses.get(sessionId) ?? "OFFLINE",
    };
  }
}
