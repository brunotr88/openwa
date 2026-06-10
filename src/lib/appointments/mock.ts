/**
 * MockCalendarProvider (M5) — calendario finto per il playground: permette
 * di provare le conversazioni di prenotazione SENZA toccare calendari reali.
 * Slot calcolati con la stessa logica pura (orari del tenant), con qualche
 * impegno fittizio per rendere la prova realistica. createAppointment non
 * crea nulla: ritorna un eventId fittizio.
 */
import { computeFreeSlots } from "./slots";
import type {
  CalendarProvider,
  CreateAppointmentInput,
  CreateAppointmentResult,
  Interval,
  ListFreeSlotsInput,
  Slot,
} from "./types";

/** Impegni finti deterministici: blocca ~metà mattinata a giorni alterni. */
function fakeBusy(from: Date, to: Date): Interval[] {
  const busy: Interval[] = [];
  const DAY = 86_400_000;
  for (let t = from.getTime(); t < to.getTime(); t += DAY) {
    const day = new Date(t);
    if (day.getUTCDate() % 2 === 0) {
      const start = new Date(day);
      start.setUTCHours(8, 0, 0, 0); // ~10:00 Roma
      busy.push({ start, end: new Date(start.getTime() + 2 * 3_600_000) });
    }
  }
  return busy;
}

export class MockCalendarProvider implements CalendarProvider {
  async listFreeSlots(input: ListFreeSlotsInput): Promise<Slot[]> {
    return computeFreeSlots({
      from: input.from,
      to: input.to,
      durationMin: input.durationMin,
      bufferMin: input.bufferMin ?? 0,
      busy: fakeBusy(input.from, input.to),
      workingHours: input.workingHours,
      maxSlots: input.maxSlots,
    });
  }

  async createAppointment(
    _input: CreateAppointmentInput
  ): Promise<CreateAppointmentResult> {
    return { eventId: `mock-${Date.now().toString(36)}` };
  }
}
