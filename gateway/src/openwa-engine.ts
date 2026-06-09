// OpenWaEngine — WaEngine implementation backed by @open-wa/wa-automate.
//
// One open-wa Client per WaSession. Sessions are created lazily (on
// startSession) and the Chromium client is kept alive. A dying session must
// NEVER crash the process: every engine operation is wrapped in try/catch and
// logged.
//
// API assumptions (open-wa v4.x — see NOTE at bottom; verify against the version
// recorded in package-lock.json):
//   - create(config): Promise<Client>
//   - config.sessionId / config.sessionDataPath / config.headless /
//     config.qrTimeout / config.authTimeout / config.multiDevice /
//     config.executablePath (we point this at the system Chromium in Docker)
//   - QR codes are emitted both via the config `qrCallback` and via the global
//     `ev` event emitter on the `qr.<sessionId>` channel; we capture whichever
//     fires and stash the base64 string keyed by sessionId.
//   - client.onMessage(cb) / client.onStateChanged(cb)
//   - client.sendText(to, body) / client.sendImage(to, dataUrl, filename, caption)
//   - client.kill()

import { create, ev } from "@open-wa/wa-automate";
import type { WaEngine, WaStatus, InboundMsg, MediaRef } from "./engine";
import { db } from "./db";

// open-wa's exact Client type varies across minor versions; we only rely on a
// small, stable subset, so use a structural type to stay decoupled.
interface OpenWaClient {
  onMessage(cb: (message: any) => void): Promise<any> | any;
  onStateChanged(cb: (state: string) => void): Promise<any> | any;
  sendText(to: string, content: string): Promise<any>;
  sendImage(to: string, dataUrl: string, filename: string, caption?: string): Promise<any>;
  kill(): Promise<any> | any;
}

type InboundHandler = (msg: InboundMsg) => Promise<void>;
type StatusHandler = (sessionId: string, status: WaStatus) => void;

const SESSIONS_DIR = process.env.SESSIONS_DIR ?? "/app/sessions";
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH;

/** Map an open-wa connection state string to our WaStatus enum. */
function mapState(state: string): WaStatus {
  switch (state) {
    case "CONNECTED":
      return "CONNECTED";
    case "CONFLICT":
    case "UNLAUNCHED":
    case "UNPAIRED":
    case "UNPAIRED_IDLE":
    case "TIMEOUT":
      return "OFFLINE";
    case "BANNED":
    case "DEPRECATED_VERSION":
      return "BANNED";
    default:
      return "OFFLINE";
  }
}

export class OpenWaEngine implements WaEngine {
  private clients = new Map<string, OpenWaClient>();
  private starting = new Map<string, Promise<{ qr?: string; status: WaStatus }>>();
  private qrCodes = new Map<string, string>();
  private statuses = new Map<string, WaStatus>();
  private inboundHandler?: InboundHandler;
  private statusHandler?: StatusHandler;

  constructor() {
    // Global QR channel: open-wa emits on `qr.<sessionId>`. Capture all.
    try {
      ev.on("qr.**", (qrcode: string, sessionId: string) => {
        if (sessionId) {
          this.qrCodes.set(sessionId, qrcode);
          this.setStatus(sessionId, "QR");
        }
      });
    } catch (err) {
      console.error("[openwa] failed to attach global qr listener:", err);
    }
  }

  onMessage(handler: InboundHandler): void {
    this.inboundHandler = handler;
  }

  onStatusChange(handler: StatusHandler): void {
    this.statusHandler = handler;
  }

  private setStatus(sessionId: string, status: WaStatus): void {
    this.statuses.set(sessionId, status);
    if (status === "CONNECTED") this.qrCodes.delete(sessionId);
    try {
      this.statusHandler?.(sessionId, status);
    } catch (err) {
      console.error(`[openwa] statusHandler threw for ${sessionId}:`, err);
    }
  }

  async startSession(sessionId: string): Promise<{ qr?: string; status: WaStatus }> {
    // Already connected → just report current state + any pending QR.
    if (this.clients.has(sessionId)) {
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

  private async launch(sessionId: string): Promise<{ qr?: string; status: WaStatus }> {
    try {
      const client = (await create({
        sessionId,
        sessionDataPath: SESSIONS_DIR,
        multiDevice: true,
        headless: true,
        qrTimeout: 0,
        authTimeout: 0,
        disableSpins: true,
        qrLogSkip: true,
        ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
        // QR also delivered here as a redundancy to the global `ev` channel.
        qrCallback: (qrcode: string) => {
          this.qrCodes.set(sessionId, qrcode);
          this.setStatus(sessionId, "QR");
        },
      } as any)) as unknown as OpenWaClient;

      this.clients.set(sessionId, client);
      this.setStatus(sessionId, "CONNECTED");
      this.wireClient(sessionId, client);

      return { qr: this.qrCodes.get(sessionId), status: this.statuses.get(sessionId) ?? "CONNECTED" };
    } catch (err) {
      console.error(`[openwa] failed to start session ${sessionId}:`, err);
      this.setStatus(sessionId, "OFFLINE");
      return { qr: this.qrCodes.get(sessionId), status: "OFFLINE" };
    }
  }

  private wireClient(sessionId: string, client: OpenWaClient): void {
    try {
      client.onStateChanged((state: string) => {
        const status = mapState(state);
        this.setStatus(sessionId, status);
      });
    } catch (err) {
      console.error(`[openwa] onStateChanged wiring failed for ${sessionId}:`, err);
    }

    try {
      client.onMessage(async (message: any) => {
        try {
          if (!this.inboundHandler) return;
          // Ignore our own outgoing echoes.
          if (message?.fromMe) return;
          const tenantId = await this.resolveTenantId(sessionId);
          if (!tenantId) {
            console.error(`[openwa] no tenant for session ${sessionId}; dropping inbound`);
            return;
          }
          const inbound = this.toInboundMsg(sessionId, tenantId, message);
          await this.inboundHandler(inbound);
        } catch (err) {
          console.error(`[openwa] inbound handling failed for ${sessionId}:`, err);
        }
      });
    } catch (err) {
      console.error(`[openwa] onMessage wiring failed for ${sessionId}:`, err);
    }
  }

  private async resolveTenantId(sessionId: string): Promise<string | null> {
    try {
      const session = await db.waSession.findUnique({
        where: { id: sessionId },
        select: { tenantId: true },
      });
      return session?.tenantId ?? null;
    } catch (err) {
      console.error(`[openwa] tenant lookup failed for ${sessionId}:`, err);
      return null;
    }
  }

  private toInboundMsg(sessionId: string, tenantId: string, message: any): InboundMsg {
    const waId: string = message?.from ?? "";
    const body: string | undefined =
      typeof message?.body === "string" && message.body.length > 0 ? message.body : undefined;
    const contactName: string | undefined =
      message?.sender?.pushname || message?.sender?.name || message?.notifyName || undefined;
    const tsSeconds: number = typeof message?.t === "number" ? message.t : Date.now() / 1000;

    let media: MediaRef | undefined;
    if (message?.mimetype) {
      media = {
        dataUrl: message?.body && message?.mimetype ? undefined : undefined,
        filename: message?.filename,
        caption: message?.caption,
        url: message?.deprecatedMms3Url,
      };
    }

    return {
      sessionId,
      tenantId,
      waId,
      contactName,
      body,
      media,
      externalId: message?.id,
      timestamp: Math.round(tsSeconds * 1000),
    };
  }

  async stopSession(sessionId: string): Promise<void> {
    const client = this.clients.get(sessionId);
    if (!client) return;
    try {
      await client.kill();
    } catch (err) {
      console.error(`[openwa] failed to kill session ${sessionId}:`, err);
    } finally {
      this.clients.delete(sessionId);
      this.qrCodes.delete(sessionId);
      this.setStatus(sessionId, "OFFLINE");
    }
  }

  async sendText(sessionId: string, waId: string, text: string): Promise<{ ack: string }> {
    const client = this.clients.get(sessionId);
    if (!client) throw new Error(`session ${sessionId} not started`);
    const ack = await client.sendText(waId, text);
    return { ack: String(ack) };
  }

  async sendMedia(sessionId: string, waId: string, media: MediaRef): Promise<{ ack: string }> {
    const client = this.clients.get(sessionId);
    if (!client) throw new Error(`session ${sessionId} not started`);
    const dataUrl = media.dataUrl ?? media.url;
    if (!dataUrl) throw new Error("media requires url or dataUrl");
    const ack = await client.sendImage(
      waId,
      dataUrl,
      media.filename ?? "file",
      media.caption ?? ""
    );
    return { ack: String(ack) };
  }
}

// NOTE: open-wa's create() config and Client method surface drift between minor
// versions. We cast the config to `any` at the call site (config keys are
// validated at runtime by open-wa) and use a structural OpenWaClient type for
// the methods we actually call. If a future open-wa upgrade renames these, the
// failures are isolated here and logged, not fatal to the process.
