"use client";

/**
 * ScheduleEditor — griglia orari per giorno con toggle + "copia su tutti".
 */
import { Copy } from "lucide-react";
import type { DaySchedule } from "@/lib/settings/schema";
import { Switch } from "./switch-setting";

const DAY_LABELS = [
  "Domenica",
  "Lunedì",
  "Martedì",
  "Mercoledì",
  "Giovedì",
  "Venerdì",
  "Sabato",
];

/** Ordine di visualizzazione: lun→dom (indici Date#getDay). */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: DaySchedule[];
  onChange: (next: DaySchedule[]) => void;
}) {
  function update(index: number, patch: Partial<DaySchedule>) {
    onChange(schedule.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function copyToAll(index: number) {
    const src = schedule[index];
    onChange(schedule.map((d) => ({ ...d, start: src.start, end: src.end })));
  }

  return (
    <div className="space-y-1">
      {DISPLAY_ORDER.map((i) => {
        const day = schedule[i];
        if (!day) return null;
        return (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-md px-2 py-2 ${
              day.enabled ? "" : "opacity-50"
            }`}
          >
            <Switch checked={day.enabled} onChange={(v) => update(i, { enabled: v })} />
            <span className="w-24 text-sm">{DAY_LABELS[i]}</span>
            {day.enabled ? (
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="time"
                  value={day.start}
                  onChange={(e) => update(i, { start: e.target.value })}
                  className="rounded-md border bg-transparent px-2 py-1 text-sm"
                />
                <span style={{ color: "var(--muted-foreground)" }}>–</span>
                <input
                  type="time"
                  value={day.end}
                  onChange={(e) => update(i, { end: e.target.value })}
                  className="rounded-md border bg-transparent px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => copyToAll(i)}
                  title="Copia questo orario su tutti i giorni"
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-brand-600/10"
                >
                  <Copy size={12} />
                  Copia su tutti
                </button>
              </div>
            ) : (
              <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                Chiuso
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
