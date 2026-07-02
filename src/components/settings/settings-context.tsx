"use client";

/**
 * SettingsProvider — stato condiviso delle impostazioni tenant (M4).
 * - settings: TenantSettings completi (merge ottimistico locale)
 * - save(patch): update ottimistico + PUT /api/settings + toast
 * Montato dalla SettingsShell e dal wizard /setup.
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { TenantSettings } from "@/lib/settings/schema";
import { deepMerge, parseTenantSettings } from "@/lib/settings/merge";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface SettingsCtx {
  tenantId: string;
  sessionId: string;
  settings: TenantSettings;
  saveState: SaveState;
  /** Update ottimistico + persist. Ritorna true se il salvataggio è andato. */
  save: (patch: Record<string, unknown>) => Promise<boolean>;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export function SettingsProvider({
  tenantId,
  sessionId,
  initialSettings,
  children,
}: {
  tenantId: string;
  sessionId: string;
  initialSettings: TenantSettings;
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<TenantSettings>(() =>
    parseTenantSettings(initialSettings)
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSeq = useRef(0);

  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<boolean> => {
      const seq = ++latestSeq.current;
      // Update ottimistico
      const previous = settings;
      const optimistic = parseTenantSettings(deepMerge(previous, patch));
      setSettings(optimistic);
      setSaveState("saving");
      if (savedTimer.current) clearTimeout(savedTimer.current);

      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, settings: patch }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { settings: TenantSettings };
        // Solo l'ultimo save applica il risultato del server / rollback.
        if (seq !== latestSeq.current) return true;
        setSettings(parseTenantSettings(data.settings));
        setSaveState("saved");
        savedTimer.current = setTimeout(() => setSaveState("idle"), 2000);
        return true;
      } catch {
        if (seq !== latestSeq.current) return false;
        setSettings(previous); // rollback
        setSaveState("error");
        savedTimer.current = setTimeout(() => setSaveState("idle"), 4000);
        return false;
      }
    },
    [settings, sessionId]
  );

  return (
    <Ctx.Provider value={{ tenantId, sessionId, settings, saveState, save }}>
      {children}
    </Ctx.Provider>
  );
}

/** Toast fisso in basso che riflette lo stato di salvataggio. */
export function SaveToast() {
  const { saveState } = useSettings();
  if (saveState === "idle") return null;
  const styles: Record<Exclude<SaveState, "idle">, { text: string; cls: string }> = {
    saving: { text: "Salvataggio…", cls: "text-muted-foreground" },
    saved: { text: "Salvato ✓", cls: "text-success-fg" },
    error: { text: "Errore di salvataggio: modifica annullata", cls: "text-danger" },
  };
  const s = styles[saveState];
  return (
    <div
      className="ow-fade fixed bottom-20 right-4 z-50 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold shadow-lg md:bottom-6 md:right-6"
      role="status"
    >
      <span className={s.cls}>{s.text}</span>
    </div>
  );
}
