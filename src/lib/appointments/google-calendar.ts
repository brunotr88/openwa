/**
 * GoogleCalendarProvider (M5) — REST puro + node:crypto, zero googleapis.
 *
 * Autenticazione: service account a livello piattaforma
 * (GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY in env). Ogni tenant condivide il
 * proprio calendario con l'email del service account e configura il
 * calendarId nei settings.
 *
 * - token: JWT RS256 firmato con crypto.createSign → oauth2.googleapis.com
 *   (scope calendar), cache in-process fino a scadenza.
 * - listFreeSlots: freebusy.query → computeFreeSlots (puro, in index.ts).
 * - createAppointment: events.insert.
 */
import { createSign } from "node:crypto";
import { computeFreeSlots } from "./slots";
import type {
  CalendarProvider,
  CreateAppointmentInput,
  CreateAppointmentResult,
  Interval,
  ListFreeSlotsInput,
  Slot,
} from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const API_BASE = "https://www.googleapis.com/calendar/v3";

// ─── Service-account credentials (platform-level env) ────────────────────────

export interface ServiceAccountCreds {
  email: string;
  privateKey: string;
}

/**
 * Legge e normalizza le credenziali del service account. La private key in
 * env può contenere `\n` letterali (Coolify/compose) — vengono ripristinati.
 * Throw con messaggio chiaro se mancano.
 */
export function getServiceAccountCreds(): ServiceAccountCreds {
  const email = process.env.GOOGLE_SA_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      "Google Calendar non configurato sulla piattaforma: impostare GOOGLE_SA_EMAIL e GOOGLE_SA_PRIVATE_KEY (service account con scope Calendar)."
    );
  }
  // Normalizza: \n escapati → newline reali, eventuali apici di troppo.
  const privateKey = rawKey.replace(/\\n/g, "\n").replace(/^['"]|['"]$/g, "").trim();
  if (!privateKey.includes("BEGIN") || !privateKey.includes("PRIVATE KEY")) {
    throw new Error(
      "GOOGLE_SA_PRIVATE_KEY non è una chiave PEM valida (atteso blocco BEGIN PRIVATE KEY)."
    );
  }
  return { email, privateKey };
}

// ─── JWT RS256 + token cache ─────────────────────────────────────────────────

function base64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

/** Firma un JWT RS256 per il flusso service-account (grant jwt-bearer). */
export function signServiceAccountJwt(
  creds: ServiceAccountCreds,
  nowSec = Math.floor(Date.now() / 1000)
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.email,
      scope: CALENDAR_SCOPE,
      aud: TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const unsigned = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(creds.privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

interface CachedToken {
  accessToken: string;
  /** Epoch ms oltre il quale il token non va riusato. */
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

/** Solo per i test. */
export function __resetGoogleTokenCache(): void {
  tokenCache = null;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  const creds = getServiceAccountCreds();
  const assertion = signServiceAccountJwt(creds);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Autenticazione Google fallita (HTTP ${res.status}): verifica GOOGLE_SA_EMAIL/GOOGLE_SA_PRIVATE_KEY. ${body.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

// ─── Provider ────────────────────────────────────────────────────────────────

async function googleFetch(
  path: string,
  init: RequestInit & { token: string }
): Promise<Response> {
  const { token, ...rest } = init;
  return fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
  });
}

export class GoogleCalendarProvider implements CalendarProvider {
  private calendarId: string;

  constructor(opts: { calendarId: string }) {
    if (!opts.calendarId.trim()) {
      throw new Error("Google Calendar: calendarId del tenant mancante.");
    }
    this.calendarId = opts.calendarId.trim();
  }

  /** Impegni (freebusy) del calendario nella finestra. */
  async listBusy(from: Date, to: Date): Promise<Interval[]> {
    const token = await getAccessToken();
    const res = await googleFetch("/freeBusy", {
      method: "POST",
      token,
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: this.calendarId }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Google freebusy fallita (HTTP ${res.status}): ${body.slice(0, 200)}`
      );
    }
    const data = (await res.json()) as {
      calendars?: Record<
        string,
        { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason?: string }> }
      >;
    };
    const cal = data.calendars?.[this.calendarId];
    if (cal?.errors?.length) {
      throw new Error(
        `Calendario "${this.calendarId}" non accessibile (${cal.errors[0]?.reason ?? "errore"}): condividilo con l'account di servizio con permesso "Apportare modifiche agli eventi".`
      );
    }
    return (cal?.busy ?? []).map((b) => ({
      start: new Date(b.start),
      end: new Date(b.end),
    }));
  }

  async listFreeSlots(input: ListFreeSlotsInput): Promise<Slot[]> {
    const busy = await this.listBusy(input.from, input.to);
    return computeFreeSlots({
      from: input.from,
      to: input.to,
      durationMin: input.durationMin,
      bufferMin: input.bufferMin ?? 0,
      busy,
      workingHours: input.workingHours,
      maxSlots: input.maxSlots,
    });
  }

  async createAppointment(
    input: CreateAppointmentInput
  ): Promise<CreateAppointmentResult> {
    const token = await getAccessToken();
    const descriptionParts = [
      input.description?.trim(),
      input.contactName ? `Cliente: ${input.contactName}` : null,
      input.contactPhone ? `Telefono: ${input.contactPhone}` : null,
      "Prenotato automaticamente da OpenWA (WhatsApp).",
    ].filter(Boolean);

    const res = await googleFetch(
      `/calendars/${encodeURIComponent(this.calendarId)}/events`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          summary: input.title,
          description: descriptionParts.join("\n"),
          start: { dateTime: input.start.toISOString() },
          end: { dateTime: input.end.toISOString() },
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Creazione evento Google fallita (HTTP ${res.status}): ${body.slice(0, 200)}`
      );
    }
    const data = (await res.json()) as { id: string; htmlLink?: string };
    return { eventId: data.id, htmlLink: data.htmlLink };
  }
}
