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
      className="grid grid-cols-1 gap-2 sm:[grid-template-columns:var(--cols)]"
      style={
        {
          "--cols": `repeat(${columns ?? options.length}, minmax(0, 1fr))`,
        } as React.CSSProperties
      }
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-xl border p-3 text-left transition-all ${
              active
                ? "border-primary bg-primary/10 shadow-sm"
                : "border-border hover:border-primary/40 hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{o.label}</span>
              {o.recommended && <RecommendedBadge />}
            </div>
            {o.description && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {o.description}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
