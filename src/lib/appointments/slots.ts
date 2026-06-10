/**
 * Calcolo slot liberi PURO (M5, testabile senza rete): orari di attività del
 * tenant (timezone-aware) ∩ finestra richiesta − impegni (freebusy),
 * con durata, buffer, preavviso minimo e orizzonte massimo.
 */
import type { HoursSettings } from "@/lib/settings/schema";
import type { Interval, Slot } from "./types";

const DAY_MS = 86_400_000;
const DEFAULT_MAX_SLOTS = 20;

// ─── Timezone helpers (puri, solo Intl) ──────────────────────────────────────

interface ZonedDate {
  y: number;
  m: number; // 1-12
  d: number;
  weekday: number; // 0 (dom) … 6 (sab), come Date#getDay
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dtf(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
}

function partsOf(date: Date, timeZone: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of dtf(timeZone).formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** Giorno di calendario (nella timezone) in cui cade `date`. */
export function zonedDate(date: Date, timeZone: string): ZonedDate {
  const p = partsOf(date, timeZone);
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    weekday: Math.max(0, WEEKDAYS.indexOf(p.weekday)),
  };
}

/** Offset (ms) della timezone rispetto a UTC al momento `date`. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = partsOf(date, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return asUtc - date.getTime();
}

/** Istante UTC corrispondente a y-m-d hh:mm nella timezone indicata. */
export function zonedToUtc(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  timeZone: string
): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Doppio passaggio per gestire correttamente i cambi DST.
  const offset1 = tzOffsetMs(new Date(guess), timeZone);
  const offset2 = tzOffsetMs(new Date(guess - offset1), timeZone);
  return new Date(guess - offset2);
}

function parseHHMM(value: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

// ─── Finestra di prenotazione (preavviso + orizzonte) ────────────────────────

export interface BookingWindowInput {
  now: Date;
  minNoticeHours: number;
  maxDaysAhead: number;
  /** Finestra richiesta dal cliente (es. "lunedì") — opzionale. */
  requestedFrom?: Date;
  requestedTo?: Date;
}

/**
 * Interseca la finestra richiesta con [now + minNotice, now + maxDaysAhead].
 * Ritorna null se l'intersezione è vuota (es. data richiesta troppo vicina
 * o oltre l'orizzonte).
 */
export function clampBookingWindow(input: BookingWindowInput): Interval | null {
  const earliest = new Date(
    input.now.getTime() + input.minNoticeHours * 3_600_000
  );
  const latest = new Date(input.now.getTime() + input.maxDaysAhead * DAY_MS);
  const from = new Date(
    Math.max(earliest.getTime(), input.requestedFrom?.getTime() ?? earliest.getTime())
  );
  const to = new Date(
    Math.min(latest.getTime(), input.requestedTo?.getTime() ?? latest.getTime())
  );
  return from < to ? { start: from, end: to } : null;
}

// ─── Calcolo slot liberi (puro) ──────────────────────────────────────────────

export interface ComputeFreeSlotsInput {
  from: Date;
  to: Date;
  durationMin: number;
  /** Pausa tra appuntamenti (minuti). */
  bufferMin?: number;
  /** Impegni esistenti (freebusy) in UTC. */
  busy: Interval[];
  workingHours: HoursSettings;
  maxSlots?: number;
}

function conflicts(slot: Slot, busy: Interval[], bufferMs: number): boolean {
  return busy.some(
    (b) =>
      slot.start.getTime() < b.end.getTime() + bufferMs &&
      slot.end.getTime() + bufferMs > b.start.getTime()
  );
}

/**
 * Slot liberi nella finestra [from, to): candidati a passo
 * durationMin + bufferMin dentro gli orari di attività di ciascun giorno
 * (timezone del tenant), esclusi quelli in conflitto con gli impegni
 * (buffer applicato su entrambi i lati).
 */
export function computeFreeSlots(input: ComputeFreeSlotsInput): Slot[] {
  const {
    from,
    to,
    durationMin,
    busy,
    workingHours,
    bufferMin = 0,
    maxSlots = DEFAULT_MAX_SLOTS,
  } = input;
  if (durationMin <= 0 || from >= to) return [];

  const tz = workingHours.timezone || "Europe/Rome";
  const durationMs = durationMin * 60_000;
  const bufferMs = bufferMin * 60_000;
  const stepMs = durationMs + bufferMs;

  const slots: Slot[] = [];
  const seenDays = new Set<string>();

  // Enumera i giorni di calendario (nella tz) coperti dalla finestra.
  for (
    let anchor = from.getTime();
    anchor < to.getTime() + DAY_MS;
    anchor += DAY_MS
  ) {
    const day = zonedDate(new Date(anchor), tz);
    const key = `${day.y}-${day.m}-${day.d}`;
    if (seenDays.has(key)) continue;
    seenDays.add(key);

    const schedule = workingHours.schedule[day.weekday];
    if (!schedule?.enabled) continue;
    const start = parseHHMM(schedule.start);
    const end = parseHHMM(schedule.end);
    if (!start || !end) continue;

    const dayStart = zonedToUtc(day.y, day.m, day.d, start.h, start.m, tz);
    const dayEnd = zonedToUtc(day.y, day.m, day.d, end.h, end.m, tz);

    for (
      let t = dayStart.getTime();
      t + durationMs <= dayEnd.getTime();
      t += stepMs
    ) {
      const slot: Slot = { start: new Date(t), end: new Date(t + durationMs) };
      if (slot.start < from || slot.end > to) continue;
      if (conflicts(slot, busy, bufferMs)) continue;
      slots.push(slot);
      if (slots.length >= maxSlots) return slots;
    }
  }
  return slots;
}

// ─── Formattazione it-IT ─────────────────────────────────────────────────────

/** "lunedì 15 giugno, 09:30" nella timezone del tenant. */
export function formatSlotItalian(start: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("it-IT", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(start).replace(" alle ore", ",");
}
