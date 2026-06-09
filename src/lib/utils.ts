/**
 * Generic UI/utility helpers (blueprint scaffold).
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, resolving conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a date as a localized day-month-year string (it-IT). */
export function formatDate(
  date: Date | string | number,
  locale = "it-IT"
): string {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/**
 * Whole days from now until `date` (negative if in the past).
 * Computed on calendar-day boundaries to avoid partial-day drift.
 */
export function daysUntil(date: Date | string | number): number {
  const target = date instanceof Date ? date : new Date(date);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(target) - startOfDay(new Date())) / MS_PER_DAY);
}
