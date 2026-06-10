/**
 * Appointments core (M5) — entry point.
 * - slots.ts: calcolo slot liberi puro (durata, buffer, preavviso,
 *   orizzonte, orari di attività timezone-aware).
 * - google-calendar.ts: provider Google (REST + node:crypto, no googleapis).
 * - getCalendarProvider(settings): factory del CalendarProvider attivo.
 */
import type { AppointmentsSettings, TenantSettings } from "@/lib/settings/schema";
import type { CalendarProvider } from "./types";
import { GoogleCalendarProvider } from "./google-calendar";

export * from "./types";
export * from "./slots";
export { GoogleCalendarProvider, getServiceAccountCreds } from "./google-calendar";

/**
 * Ritorna il CalendarProvider attivo per i settings, o null quando le
 * prenotazioni con calendario reale non sono configurate (nessuno /
 * calendly_link / google senza calendarId).
 */
export function getCalendarProvider(
  settings: Pick<TenantSettings, "appointments">
): CalendarProvider | null {
  const appt: AppointmentsSettings = settings.appointments;
  if (appt.provider !== "google_calendar") return null;
  if (!appt.googleCalendarId.trim()) return null;
  return new GoogleCalendarProvider({ calendarId: appt.googleCalendarId.trim() });
}
