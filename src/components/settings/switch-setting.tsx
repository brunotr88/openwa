"use client";

/**
 * SwitchSetting — toggle con autosave (via onChange async) + helper text.
 * `locked` per le impostazioni non disattivabili (escalateOnHumanRequest).
 */
import { Lock } from "lucide-react";
import { SettingRow } from "./setting-row";

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-brand-600" : "bg-gray-400/40"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function SwitchSetting({
  label,
  description,
  checked,
  onChange,
  recommended,
  locked,
  lockedHint,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange?: (next: boolean) => void;
  recommended?: boolean;
  /** Non disattivabile: mostra lucchetto, toggle disabilitato. */
  locked?: boolean;
  lockedHint?: string;
}) {
  return (
    <SettingRow label={label} description={description} recommended={recommended}>
      <div className="flex items-center gap-2">
        {locked && (
          <span
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--muted-foreground)" }}
            title={lockedHint}
          >
            <Lock size={12} />
          </span>
        )}
        <Switch checked={checked} onChange={onChange} disabled={locked} />
      </div>
    </SettingRow>
  );
}
