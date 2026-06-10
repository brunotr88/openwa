"use client";

/**
 * ResetToRecommended — bottone per pagina con dialog che mostra il diff
 * rispetto alla configurazione consigliata (pattern respond.io).
 */
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import type { TenantSettings } from "@/lib/settings/schema";
import { recommendedDefaults } from "@/lib/settings/defaults";
import { useSettings } from "./settings-context";

type SectionKey = Exclude<keyof TenantSettings, "setup">;

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? "—" : `${v.length} elementi`;
  if (typeof v === "boolean") return v ? "Attivo" : "Disattivo";
  if (v === null || v === "" || v === undefined) return "—";
  if (typeof v === "object") return "personalizzato";
  return String(v);
}

export function ResetToRecommended({
  sections,
  /** Chiavi da preservare (es. dati anagrafici della persona). */
  keep = [],
}: {
  sections: SectionKey[];
  keep?: string[];
}) {
  const { settings, save } = useSettings();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Diff: campi diversi dal consigliato nelle sezioni richieste.
  const diffs: Array<{ section: string; field: string; from: unknown; to: unknown }> = [];
  for (const section of sections) {
    const current = settings[section] as Record<string, unknown>;
    const recommended = recommendedDefaults[section] as Record<string, unknown>;
    for (const [field, recValue] of Object.entries(recommended)) {
      if (keep.includes(field)) continue;
      if (JSON.stringify(current[field]) !== JSON.stringify(recValue)) {
        diffs.push({ section, field, from: current[field], to: recValue });
      }
    }
  }

  async function reset() {
    setBusy(true);
    const patch: Record<string, unknown> = {};
    for (const section of sections) {
      const rec = { ...(recommendedDefaults[section] as Record<string, unknown>) };
      const cur = settings[section] as Record<string, unknown>;
      for (const k of keep) {
        if (k in cur) rec[k] = cur[k];
      }
      patch[section] = rec;
    }
    await save(patch);
    setBusy(false);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/60"
      >
        <RotateCcw size={13} />
        Ripristina consigliati
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div
            className="ow-fade w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-lg"
            role="dialog"
            aria-modal="true"
          >
            <h3 className="font-display text-base font-semibold">
              Ripristinare la configurazione consigliata?
            </h3>
            {diffs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Questa pagina usa già la configurazione consigliata.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto text-xs">
                {diffs.map((d) => (
                  <div
                    key={`${d.section}.${d.field}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                  >
                    <span className="font-medium">{d.field}</span>
                    <span className="text-muted-foreground">
                      {formatValue(d.from)} →{" "}
                      <span className="font-semibold text-success-fg">
                        {formatValue(d.to)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                Annulla
              </button>
              {diffs.length > 0 && (
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy}
                  className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-fg shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-60"
                >
                  {busy ? "Ripristino…" : "Ripristina"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
