"use client";

/**
 * PresetCardGroup — card radio che mostrano i valori del profilo
 * (pattern Fin/GREEN-API). Modificando un campo a mano si passa a
 * "Personalizzato" (gestito dal chiamante).
 */
import { Check } from "lucide-react";
import { RecommendedBadge } from "./recommended-badge";

export interface PresetCardOption<V extends string> {
  value: V;
  title: string;
  subtitle?: string;
  recommended?: boolean;
  /** Coppie etichetta → valore mostrate sulla card. */
  values: Array<{ label: string; value: string }>;
}

export function PresetCardGroup<V extends string>({
  options,
  value,
  onChange,
}: {
  options: PresetCardOption<V>[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`relative rounded-2xl border p-4 text-left transition-all ${
              active
                ? "border-primary bg-primary/10 shadow-sm"
                : "border-border hover:border-primary/40 hover:bg-muted/50"
            }`}
          >
            {active && (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-fg">
                <Check size={12} />
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{o.title}</span>
              {o.recommended && <RecommendedBadge />}
            </div>
            {o.subtitle && (
              <p className="mt-1 text-xs text-muted-foreground">{o.subtitle}</p>
            )}
            <dl className="mt-3 space-y-1">
              {o.values.map((v) => (
                <div key={v.label} className="flex justify-between gap-2 text-xs">
                  <dt className="text-muted-foreground">{v.label}</dt>
                  <dd className="font-mono font-medium">{v.value}</dd>
                </div>
              ))}
            </dl>
          </button>
        );
      })}
    </div>
  );
}
