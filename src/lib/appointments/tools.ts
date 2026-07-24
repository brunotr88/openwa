/**
 * Tool AI per gli appuntamenti (M5) — condivisi da reply pipeline e
 * playground: check_availability + book_appointment.
 *
 * - bookingMode "proponi": la descrizione di book_appointment impone di
 *   chiamarlo SOLO dopo conferma esplicita dello slot da parte del cliente.
 * - allowBooking=false (risposta in bozza / COPILOT): il tool NON crea
 *   l'evento e dice all'AI di proporre la conferma tramite operatore —
 *   mai prenotazioni reali da una bozza non approvata.
 * - simulated=true (playground su settings draft): descrizioni etichettate
 *   come simulazione.
 */
import type { ToolSpec } from "@/lib/ai/provider";
import type { ToolExecutors } from "@/lib/ai/tool-loop";
import type { TenantSettings } from "@/lib/settings/schema";
import { sanitizePromptField } from "@/lib/settings";
import type { CalendarProvider } from "./types";
import { clampBookingWindow, formatSlotItalian, zonedToUtc } from "./slots";

const MAX_TOOL_SLOTS = 12;

export interface BookedAppointment {
  eventId: string;
  htmlLink?: string;
  start: Date;
  end: Date;
  title: string;
  name: string;
  service?: string;
}

export interface AppointmentToolsOptions {
  settings: Pick<TenantSettings, "appointments" | "hours">;
  calendar: CalendarProvider;
  contact?: { name?: string | null; phone?: string | null };
  /** false → book_appointment non crea eventi reali (es. bozza COPILOT). */
  allowBooking: boolean;
  /** true → playground: etichetta le descrizioni come simulazione. */
  simulated?: boolean;
  /** Callback dopo una prenotazione riuscita (audit log). */
  onBooked?: (booked: BookedAppointment) => Promise<void> | void;
  now?: () => Date;
}

function parseDateOnly(value: unknown): { y: number; m: number; d: number } | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function buildAppointmentTools(opts: AppointmentToolsOptions): {
  tools: ToolSpec[];
  executors: ToolExecutors;
} {
  const { settings, calendar, contact, allowBooking, simulated, onBooked } = opts;
  const appt = settings.appointments;
  const tz = settings.hours.timezone || "Europe/Rome";
  const now = opts.now ?? (() => new Date());
  const simNote = simulated
    ? " ATTENZIONE: modalità di prova (playground) — i dati sono SIMULATI, nessun calendario reale viene letto o modificato."
    : "";

  const bookingPolicy =
    appt.bookingMode === "proponi"
      ? "Chiamalo SOLO dopo che il cliente ha confermato esplicitamente in chat uno slot specifico tra quelli proposti (es. \"sì, va bene lunedì alle 10\"). MAI prenotare senza conferma esplicita."
      : "Chiamalo appena il cliente sceglie uno degli slot disponibili.";

  const tools: ToolSpec[] = [
    {
      name: "check_availability",
      description:
        `Controlla gli orari realmente liberi sul calendario per un appuntamento di ${appt.slotDurationMin} minuti. ` +
        "Usalo SEMPRE prima di proporre orari al cliente. Puoi limitare la ricerca a una data precisa o a un intervallo." +
        simNote,
      inputSchema: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Data precisa richiesta dal cliente, formato YYYY-MM-DD",
          },
          date_from: {
            type: "string",
            description: "Inizio intervallo di ricerca, formato YYYY-MM-DD",
          },
          date_to: {
            type: "string",
            description: "Fine intervallo di ricerca (inclusa), formato YYYY-MM-DD",
          },
        },
      },
    },
    {
      name: "book_appointment",
      description:
        "Prenota un appuntamento sul calendario. " +
        bookingPolicy +
        " Chiedi sempre prima il nome del cliente." +
        simNote,
      inputSchema: {
        type: "object",
        properties: {
          datetime: {
            type: "string",
            description:
              "Inizio dell'appuntamento in formato ISO 8601 (es. 2026-06-15T10:00:00+02:00), esattamente uno slot proposto da check_availability",
          },
          name: { type: "string", description: "Nome del cliente" },
          service: {
            type: "string",
            description: "Servizio/motivo dell'appuntamento (opzionale)",
          },
        },
        required: ["datetime", "name"],
      },
    },
  ];

  const executors: ToolExecutors = {
    check_availability: async (input) => {
      const date = parseDateOnly(input.date);
      const dateFrom = parseDateOnly(input.date_from) ?? date;
      const dateTo = parseDateOnly(input.date_to) ?? date;

      const requestedFrom = dateFrom
        ? zonedToUtc(dateFrom.y, dateFrom.m, dateFrom.d, 0, 0, tz)
        : undefined;
      const requestedTo = dateTo
        ? zonedToUtc(dateTo.y, dateTo.m, dateTo.d + 1, 0, 0, tz)
        : undefined;

      const window = clampBookingWindow({
        now: now(),
        minNoticeHours: appt.minNoticeHours,
        maxDaysAhead: appt.maxDaysAhead,
        requestedFrom,
        requestedTo,
      });
      if (!window) {
        return {
          slots: [],
          message: `Nessuno slot disponibile nella finestra richiesta: serve un preavviso di almeno ${appt.minNoticeHours} ore e si può prenotare al massimo ${appt.maxDaysAhead} giorni in anticipo.`,
        };
      }

      const slots = await calendar.listFreeSlots({
        from: window.start,
        to: window.end,
        durationMin: appt.slotDurationMin,
        bufferMin: appt.bufferMin,
        workingHours: settings.hours,
        maxSlots: MAX_TOOL_SLOTS,
      });

      return {
        timezone: tz,
        slots: slots.map((s) => ({
          datetime: s.start.toISOString(),
          label: formatSlotItalian(s.start, tz),
        })),
        ...(slots.length === 0
          ? { message: "Nessuno slot libero nella finestra richiesta: prova altre date." }
          : {}),
      };
    },

    book_appointment: async (input) => {
      const name =
        typeof input.name === "string" ? sanitizePromptField(input.name, 80) : "";
      const service =
        typeof input.service === "string" && input.service.trim()
          ? input.service.trim()
          : undefined;
      const start =
        typeof input.datetime === "string" ? new Date(input.datetime) : null;

      if (!start || Number.isNaN(start.getTime())) {
        return { ok: false, error: "datetime non valido: usa il formato ISO 8601." };
      }
      if (!name) {
        return { ok: false, error: "Serve il nome del cliente per prenotare." };
      }
      if (!allowBooking) {
        return {
          ok: false,
          booked: false,
          error:
            "La prenotazione automatica non è attiva per questa conversazione: NON dire al cliente che l'appuntamento è confermato. Proponi lo slot e spiega che un operatore invierà la conferma definitiva a breve.",
        };
      }

      const end = new Date(start.getTime() + appt.slotDurationMin * 60_000);

      // Ri-valida lo slot PRIMA di creare l'evento: un datetime iniettato via
      // prompt (passato/notturno/lontano/già occupato) non deve mai finire sul
      // calendario. Si usano gli stessi vincoli di check_availability.
      const window = clampBookingWindow({
        now: now(),
        minNoticeHours: appt.minNoticeHours,
        maxDaysAhead: appt.maxDaysAhead,
      });
      if (!window || start < window.start || end > window.end) {
        return {
          ok: false,
          booked: false,
          error: `Lo slot richiesto non è prenotabile: serve un preavviso di almeno ${appt.minNoticeHours} ore e si può prenotare al massimo ${appt.maxDaysAhead} giorni in anticipo. Usa check_availability e proponi un orario valido.`,
        };
      }
      const free = await calendar.listFreeSlots({
        from: start,
        to: end,
        durationMin: appt.slotDurationMin,
        bufferMin: appt.bufferMin,
        workingHours: settings.hours,
        maxSlots: MAX_TOOL_SLOTS,
      });
      if (!free.some((s) => s.start.getTime() === start.getTime())) {
        return {
          ok: false,
          booked: false,
          error:
            "Lo slot richiesto non è (più) disponibile o è fuori dagli orari di attività: usa check_availability per proporre un orario libero e riprova.",
        };
      }

      const title = service ? `WhatsApp: ${name} — ${service}` : `WhatsApp: ${name}`;

      const result = await calendar.createAppointment({
        start,
        end,
        title,
        contactName: name,
        contactPhone: contact?.phone ?? undefined,
        description: service ? `Servizio: ${service}` : undefined,
      });

      const booked: BookedAppointment = {
        eventId: result.eventId,
        htmlLink: result.htmlLink,
        start,
        end,
        title,
        name,
        service,
      };
      await onBooked?.(booked);

      return {
        ok: true,
        booked: true,
        eventId: result.eventId,
        when: formatSlotItalian(start, tz),
        ...(appt.confirmationMessage
          ? {
              instruction:
                "Invia ora al cliente un breve messaggio di conferma con giorno, ora e nome.",
            }
          : {}),
      };
    },
  };

  return { tools, executors };
}

/**
 * Righe aggiuntive di system prompt per gli appuntamenti.
 * - google_calendar: istruzioni d'uso dei tool (max 2-3 slot, conferma).
 * - calendly_link: condividi il link quando il cliente vuole prenotare.
 * Ritorna null quando la sezione è disattivata/incompleta.
 */
export function appointmentSystemPrompt(
  settings: Pick<TenantSettings, "appointments">
): string | null {
  const appt = settings.appointments;
  if (appt.provider === "calendly_link" && appt.calendlyUrl.trim()) {
    return `Prenotazione appuntamenti: quando il cliente vuole prenotare, condividi questo link: ${appt.calendlyUrl.trim()}`;
  }
  if (appt.provider === "google_calendar" && appt.googleCalendarId.trim()) {
    const lines = [
      "Prenotazione appuntamenti: puoi controllare la disponibilità reale del calendario e prenotare con gli strumenti a disposizione.",
      "- Controlla sempre la disponibilità con check_availability prima di proporre orari: mai inventare slot.",
      "- Proponi al massimo 2-3 slot alla volta, in orari diversi della giornata quando possibile.",
      appt.bookingMode === "proponi"
        ? "- Prenota con book_appointment SOLO dopo che il cliente ha confermato esplicitamente uno slot specifico. Prima della prenotazione chiedi e conferma il nome."
        : "- Quando il cliente sceglie uno slot, prenota subito con book_appointment (chiedi prima il nome se non lo conosci).",
      appt.confirmationMessage
        ? "- Dopo la prenotazione invia un breve riepilogo: giorno, ora e nome."
        : null,
    ].filter(Boolean);
    return lines.join("\n");
  }
  return null;
}
