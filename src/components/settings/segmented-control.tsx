"use client";

/**
 * SegmentedControl — 2-4 opzioni a scelta chiusa con descrizione e badge
 * Consigliato (pattern Zendesk/MS Copilot: mai textarea come primo livello).
 */
import { RecommendedBadge } from "./recommended-badge";

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  description?: string;
  recommended?: boolean;
}

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  columns,
}: {
  options: SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-lg border p-3 text-left transition-colors ${
              active
                ? "border-brand-600 bg-brand-600/10"
                : "hover:bg-brand-600/5"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{o.label}</span>
              {o.recommended && <RecommendedBadge />}
            </div>
            {o.description && (
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                {o.description}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
