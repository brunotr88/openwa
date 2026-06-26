/**
 * POST /api/appointments/verify (M5) — verifica il collegamento Google
 * Calendar del tenant: esegue una freebusy.query reale sul calendarId
 * indicato (o quello salvato) e ritorna { ok } o un errore comprensibile.
 * Nessuna mutazione del calendario.
 */
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { getActor, resolveTenantId } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { getSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";
import { db } from "@/lib/db";
import { GoogleCalendarProvider } from "@/lib/appointments";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tenantId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  /** calendarId da provare (anche non ancora salvato). */
  calendarId: z.string().min(1).max(200).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  // 10 verifiche/min per utente.
  const rl = rateLimit(`appt-verify:${actor.userId}`, 10, 60_000);
  if (!rl.allowed) {
    return Response.json({ error: "rate limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const tenantId = await resolveTenantId(actor, parsed.data.tenantId ?? null);
  if (!tenantId) {
    return Response.json(
      { error: parsed.data.tenantId ? "forbidden" : "no tenant available" },
      { status: parsed.data.tenantId ? 403 : 400 }
    );
  }

  const requestedSession = parsed.data.sessionId;
  const sessions = await db.waSession.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, status: true, createdAt: true },
  });
  const sessionId =
    (requestedSession && sessions.some((s) => s.id === requestedSession) && requestedSession) ||
    pickPrimarySession(sessions);

  const settings = sessionId
    ? await getSessionSettings(sessionId)
    : null;
  const calendarId =
    parsed.data.calendarId?.trim() || (settings?.appointments.googleCalendarId.trim() ?? "");
  if (!calendarId) {
    return Response.json({
      ok: false,
      error: "Inserisci prima l'ID del calendario Google.",
    });
  }

  try {
    const provider = new GoogleCalendarProvider({ calendarId });
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 86_400_000);
    const busy = await provider.listBusy(from, to);

    await auditLog({
      userId: actor.userId,
      tenantId,
      action: "appointments.verify",
      entity: "Tenant",
      entityId: tenantId,
      meta: { calendarId, ok: true, busyNext7Days: busy.length },
    });
    return Response.json({ ok: true, busyNext7Days: busy.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await auditLog({
      userId: actor.userId,
      tenantId,
      action: "appointments.verify",
      entity: "Tenant",
      entityId: tenantId,
      meta: { calendarId, ok: false, error: message },
    });
    return Response.json({ ok: false, error: friendlyError(message) });
  }
}

/** Traduce gli errori tecnici in messaggi azionabili per l'utente. */
function friendlyError(message: string): string {
  if (message.includes("GOOGLE_SA_EMAIL") || message.includes("GOOGLE_SA_PRIVATE_KEY")) {
    return "L'account di servizio Google non è configurato sulla piattaforma: contatta l'amministratore.";
  }
  if (message.includes("non accessibile") || message.includes("notFound")) {
    return "Calendario non trovato o non condiviso: verifica l'ID e condividi il calendario con l'email dell'account di servizio (permesso \"Apportare modifiche agli eventi\").";
  }
  if (message.includes("Autenticazione Google fallita")) {
    return "Autenticazione Google fallita: le credenziali dell'account di servizio non sono valide. Contatta l'amministratore.";
  }
  return `Verifica fallita: ${message}`;
}
