/**
 * Appointments core types (M5).
 * CalendarProvider è l'astrazione: aggiungere un provider (es. Outlook) =
 * nuova classe, zero refactor altrove.
 */
import type { HoursSettings } from "@/lib/settings/schema";

/** Intervallo [start, end) in UTC. */
export interface Interval {
  start: Date;
  end: Date;
}

/** Slot prenotabile [start, end) in UTC. */
export type Slot = Interval;

export interface ListFreeSlotsInput {
  /** Inizio finestra richiesta (già clampata su preavviso/orizzonte). */
  from: Date;
  /** Fine finestra richiesta. */
  to: Date;
  durationMin: number;
  /** Orari di attività del tenant (settings.hours, timezone inclusa). */
  workingHours: HoursSettings;
  /** Pausa tra appuntamenti (minuti) — default 0. */
  bufferMin?: number;
  /** Numero massimo di slot ritornati — default 20. */
  maxSlots?: number;
}

export interface CreateAppointmentInput {
  start: Date;
  end: Date;
  title: string;
  description?: string;
  contactName?: string;
  contactPhone?: string;
}

export interface CreateAppointmentResult {
  eventId: string;
  htmlLink?: string;
}

export interface CalendarProvider {
  listFreeSlots(input: ListFreeSlotsInput): Promise<Slot[]>;
  createAppointment(
    input: CreateAppointmentInput
  ): Promise<CreateAppointmentResult>;
}
