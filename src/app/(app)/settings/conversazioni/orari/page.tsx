"use client";

/**
 * Conversazioni → Orari e disponibilità: orari per giorno + comportamento
 * fuori orario (afterHoursMode).
 */
import { useSettings } from "@/components/settings/settings-context";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { SegmentedControl } from "@/components/settings/segmented-control";
import { SwitchSetting } from "@/components/settings/switch-setting";
import { ScheduleEditor } from "@/components/settings/schedule-editor";
import { AdviceCallout } from "@/components/settings/advice-callout";
import { ResetToRecommended } from "@/components/settings/reset-to-recommended";

const TIMEZONES = [
  "Europe/Rome",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Berlin",
  "Europe/Paris",
  "UTC",
];

export default function OrariPage() {
  const { settings, save } = useSettings();
  const { hours } = settings;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Orari e disponibilità</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Quando è operativo il tuo team — e cosa fa l&apos;AI nel resto del tempo.
          </p>
        </div>
        <ResetToRecommended sections={["hours"]} />
      </header>

      <SettingsCard
        title="Comportamento dell'AI"
        description="L'AI 24/7 è il vantaggio principale: di notte qualifica e prenota."
      >
        <SettingRow label="Quando risponde l'AI" stacked>
          <SegmentedControl
            value={hours.afterHoursMode}
            onChange={(v) => void save({ hours: { afterHoursMode: v } })}
            options={[
              {
                value: "ai_sempre",
                label: "AI sempre attiva",
                description: "Risponde 24/7, anche in orario di lavoro",
                recommended: true,
              },
              {
                value: "ai_fuori_orario",
                label: "AI fuori orario",
                description: "In orario risponde il team, di notte l'AI",
              },
              {
                value: "solo_assenza",
                label: "Solo bozze",
                description: "L'AI prepara bozze, mai invii automatici",
              },
            ]}
          />
        </SettingRow>

        <SwitchSetting
          label="Disclaimer fuori orario"
          description="Fuori orario l'AI dichiara quando il team è disponibile."
          checked={hours.afterHoursDisclaimer}
          recommended
          onChange={(v) => void save({ hours: { afterHoursDisclaimer: v } })}
        />
      </SettingsCard>

      <SettingsCard
        title="Orari di attività"
        description="Default Italia: gli utenti si aspettano una risposta entro pochi minuti in orario di lavoro."
      >
        <div className="space-y-4 py-3">
          <ScheduleEditor
            schedule={hours.schedule}
            onChange={(schedule) => void save({ hours: { schedule } })}
          />
          <SettingRow label="Fuso orario">
            <select
              value={hours.timezone}
              onChange={(e) => void save({ hours: { timezone: e.target.value } })}
              className="rounded-md border bg-transparent px-3 py-2 text-sm"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </SettingRow>
        </div>

        <AdviceCallout title="SLA consigliati per l'Italia">
          <p>
            Prima risposta &lt; 5 minuti (AI), presa in carico umana &lt; 1 ora
            in orario lavorativo. Le chat fuori orario che richiedono un umano
            restano in coda «da gestire» con la bozza AI pronta.
          </p>
        </AdviceCallout>
      </SettingsCard>
    </div>
  );
}
