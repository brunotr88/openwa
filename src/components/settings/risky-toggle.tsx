"use client";

/**
 * RiskyToggle — toggle "pericoloso" con alert inline (NN/g, respond.io):
 * - severity "amber": warning inline quando in stato rischioso
 * - severity "red":   alert rosso + conferma esplicita prima di attivare
 */
import { useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { SettingRow } from "./setting-row";
import { Switch } from "./switch-setting";

export function RiskyToggle({
  label,
  description,
  checked,
  onChange,
  severity,
  warning,
  confirmText,
  riskyWhen = "on",
  recommended,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  severity: "amber" | "red";
  /** Testo dell'alert mostrato quando il toggle è in stato rischioso. */
  warning: string;
  /** Severity red: testo della conferma esplicita. */
  confirmText?: string;
  /** Quale stato è rischioso: "on" (attivarlo) o "off" (disattivarlo). */
  riskyWhen?: "on" | "off";
  recommended?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const isRisky = riskyWhen === "on" ? checked : !checked;

  function requestChange(next: boolean) {
    const goingRisky = riskyWhen === "on" ? next : !next;
    if (severity === "red" && goingRisky) {
      setConfirming(true);
      return;
    }
    onChange(next);
  }

  const palette =
    severity === "red"
      ? "border-red-500/40 bg-red-500/10 text-red-600"
      : "border-amber-500/40 bg-amber-500/10 text-amber-600";

  return (
    <div>
      <SettingRow label={label} description={description} recommended={recommended}>
        <Switch checked={checked} onChange={requestChange} />
      </SettingRow>

      {isRisky && !confirming && (
        <div className={`mb-4 flex items-start gap-2 rounded-md border p-3 text-xs ${palette}`}>
          {severity === "red" ? (
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          )}
          <p className="leading-relaxed">{warning}</p>
        </div>
      )}

      {confirming && (
        <div className={`mb-4 space-y-3 rounded-md border p-3 text-xs ${palette}`}>
          <div className="flex items-start gap-2">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <p className="leading-relaxed">{confirmText ?? warning}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onChange(riskyWhen === "on");
              }}
              className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white"
            >
              Confermo, capisco il rischio
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border px-3 py-1.5 font-medium"
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
