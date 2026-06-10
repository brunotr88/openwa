"use client";

/**
 * Conversazioni → Preferenze Inbox: filtri JID (whatsapp-ops.md) e
 * chiusura automatica conversazioni inattive.
 */
import { useState } from "react";
import { useSettings } from "@/components/settings/settings-context";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { SegmentedControl } from "@/components/settings/segmented-control";
import { SwitchSetting } from "@/components/settings/switch-setting";
import { ResetToRecommended } from "@/components/settings/reset-to-recommended";

export default function InboxPrefsPage() {
  const { settings, save } = useSettings();
  const { inbox } = settings;
  const [days, setDays] = useState(inbox.autoCloseInactiveDays);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Preferenze Inbox</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Cosa entra nella tua inbox e come viene tenuta in ordine.
          </p>
        </div>
        <ResetToRecommended sections={["inbox"]} />
      </header>

      <SettingsCard
        title="Filtri messaggi"
        description="Il rumore di WhatsApp (stati, canali, eventi di sistema) non deve intasare l'inbox né l'AI."
      >
        <SwitchSetting
          label="Ignora Stati e Storie"
          description="Gli aggiornamenti di stato dei contatti (status@broadcast) non vengono processati né mostrati."
          checked={inbox.filterStatusBroadcast}
          recommended
          onChange={(v) => void save({ inbox: { filterStatusBroadcast: v } })}
        />
        <SwitchSetting
          label="Ignora Canali WhatsApp"
          description="I messaggi dei canali (@newsletter) non entrano nella inbox."
          checked={inbox.filterNewsletter}
          recommended
          onChange={(v) => void save({ inbox: { filterNewsletter: v } })}
        />
        <SettingRow
          label="Gruppi"
          description="Mostra ma non rispondere è il default sicuro: l'automazione nei gruppi è ad alto rischio ban (toggle dedicato in «Invio e protezione numero»)."
          stacked
        >
          <SegmentedControl
            value={inbox.filterGroups}
            onChange={(v) => void save({ inbox: { filterGroups: v } })}
            options={[
              {
                value: "mostra_no_ai",
                label: "Mostra senza AI",
                description: "I gruppi appaiono in inbox, l'AI non risponde",
                recommended: true,
              },
              {
                value: "ignora",
                label: "Ignora del tutto",
                description: "I messaggi di gruppo vengono scartati",
              },
            ]}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Pulizia automatica">
        <SettingRow
          label="Chiudi conversazioni inattive"
          description="Le conversazioni senza messaggi da N giorni vengono chiuse automaticamente. 0 = mai."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              onBlur={() => {
                const v = Math.max(0, Math.min(365, days || 0));
                setDays(v);
                if (v !== inbox.autoCloseInactiveDays) {
                  void save({ inbox: { autoCloseInactiveDays: v } });
                }
              }}
              className="w-24 rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
            />
            <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              giorni
            </span>
          </div>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
