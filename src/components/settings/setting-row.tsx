"use client";

/**
 * SettingRow — label + helper text (pattern FormDescription) + controllo.
 * Il controllo va a destra (toggle/select) o sotto (controlli larghi).
 */
import { RecommendedBadge } from "./recommended-badge";

export function SettingRow({
  label,
  description,
  recommended,
  children,
  stacked = false,
}: {
  label: string;
  /** Helper text dalla ricerca — sempre visibile sotto la label. */
  description?: string;
  /** Mostra il badge "Consigliato" accanto alla label. */
  recommended?: boolean;
  children?: React.ReactNode;
  /** true → controllo sotto la label (per controlli larghi). */
  stacked?: boolean;
}) {
  return (
    <div
      className={`flex gap-4 border-b border-border py-4 last:border-b-0 ${
        stacked
          ? "flex-col"
          : "flex-col sm:flex-row sm:items-center sm:justify-between"
      }`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{label}</p>
          {recommended && <RecommendedBadge />}
        </div>
        {description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && <div className={stacked ? "" : "sm:shrink-0"}>{children}</div>}
    </div>
  );
}

/** Card contenitore per un gruppo di SettingRow. */
export function SettingsCard({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      <div>{children}</div>
    </section>
  );
}
