"use client";

/**
 * Agente AI → Comportamento risposte: stile, regole fai/non-fare,
 * escalation a umano, memoria e guardrail. Helper text dalla tabella
 * "impostazioni AI raccomandate" (ai-strategies.md).
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { getPreset } from "@/lib/settings/presets";
import { useSettings } from "@/components/settings/settings-context";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { SegmentedControl } from "@/components/settings/segmented-control";
import { SwitchSetting } from "@/components/settings/switch-setting";
import { RuleList } from "@/components/settings/rule-list";
import { ResetToRecommended } from "@/components/settings/reset-to-recommended";
import { AdviceCallout } from "@/components/settings/advice-callout";

function SliderSetting({
  label,
  description,
  value,
  min,
  max,
  onCommit,
  unit,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
  unit?: string;
}) {
  const [local, setLocal] = useState(value);
  return (
    <SettingRow label={label} description={description} stacked>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          value={local}
          onChange={(e) => setLocal(Number(e.target.value))}
          onMouseUp={() => local !== value && onCommit(local)}
          onTouchEnd={() => local !== value && onCommit(local)}
          onKeyUp={() => local !== value && onCommit(local)}
          className="w-64 accent-primary"
        />
        <span className="w-16 text-sm font-medium">
          {local} {unit}
        </span>
      </div>
    </SettingRow>
  );
}

export default function ComportamentoPage() {
  const { settings, save } = useSettings();
  const { behavior } = settings;
  const preset = getPreset(settings.persona.presetId);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(behavior.customInstructions);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Comportamento risposte</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Come risponde il bot e quando passa la conversazione a un umano.
          </p>
        </div>
        <ResetToRecommended sections={["behavior"]} />
      </header>

      <SettingsCard title="Modalità del bot">
        <SettingRow
          label="Modalità AI"
          description="Inizia in Copilot: approvi ogni bozza. Passa ad Auto quando approvi >90% delle bozze senza modificarle."
          stacked
        >
          <SegmentedControl
            value={behavior.aiMode}
            onChange={(v) => void save({ behavior: { aiMode: v } })}
            options={[
              { value: "AUTO", label: "Auto", description: "Risponde da solo, 24/7" },
              { value: "COPILOT", label: "Copilot", description: "Prepara bozze, tu approvi", recommended: true },
              { value: "OFF", label: "Spento", description: "Nessuna risposta AI" },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="Stile risposta"
          description="Bassa creatività = precisa e ripetibile. Alta = più calore (vendita, fitness). Oltre 0.7 sconsigliato."
          stacked
        >
          <SegmentedControl
            value={behavior.responseStyle}
            onChange={(v) => void save({ behavior: { responseStyle: v } })}
            options={[
              { value: "preciso", label: "Preciso", description: "Fedele alle informazioni", recommended: true },
              { value: "bilanciato", label: "Bilanciato", description: "Naturale e affidabile" },
              { value: "creativo", label: "Creativo", description: "Più caldo e vario" },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="Lunghezza risposte"
          description="Su WhatsApp vincono i messaggi corti: 2-4 frasi."
          stacked
        >
          <SegmentedControl
            value={behavior.maxResponseLength}
            onChange={(v) => void save({ behavior: { maxResponseLength: v } })}
            options={[
              { value: "breve", label: "Breve", description: "~300 caratteri", recommended: true },
              { value: "media", label: "Media", description: "~600 caratteri" },
              { value: "lunga", label: "Lunga", description: "~1000 caratteri" },
            ]}
          />
        </SettingRow>

        <SwitchSetting
          label="Presentazione come AI"
          description="L'assistente si presenta come AI nel primo messaggio (trasparenza, AI Act)."
          checked={behavior.aiDisclosure}
          recommended
          onChange={(v) => void save({ behavior: { aiDisclosure: v } })}
        />
        <SwitchSetting
          label="Messaggio di benvenuto"
          description="Saluto al primo contatto: presentati come AI e di' cosa sai fare."
          checked={behavior.welcomeMessageEnabled}
          onChange={(v) => void save({ behavior: { welcomeMessageEnabled: v } })}
        />
      </SettingsCard>

      <SettingsCard
        title="Regole del bot"
        description="Istruzioni naturali, una per riga (max ~300 caratteri ciascuna)."
      >
        <div className="space-y-6 py-3">
          <RuleList
            title="Cose da fare ✓"
            rules={behavior.doRules}
            onChange={(rules) => void save({ behavior: { doRules: rules } })}
            examples={preset?.doExamples ?? []}
            placeholder="Es. Proponi sempre un appuntamento…"
            accent="green"
          />
          <RuleList
            title="Cose da non fare ✗"
            rules={behavior.dontRules}
            onChange={(rules) => void save({ behavior: { dontRules: rules } })}
            examples={preset?.dontExamples ?? []}
            placeholder="Es. Non promettere sconti…"
            accent="red"
          />
          <RuleList
            title="Argomenti vietati"
            rules={behavior.forbiddenTopics}
            onChange={(topics) => void save({ behavior: { forbiddenTopics: topics } })}
            placeholder="Es. concorrenti, politica…"
            accent="red"
            maxRules={30}
          />
          <p className="text-xs text-muted-foreground">
            Argomenti su cui l&apos;AI declina sempre, con gentilezza.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Passaggio a umano (escalation)"
        description="Meglio un falso positivo (escalation inutile) che un cliente frustrato."
      >
        <SwitchSetting
          label="Cliente chiede una persona"
          description="Quando il cliente chiede una persona, la ottiene. Non disattivabile."
          checked={behavior.escalateOnHumanRequest}
          locked
          lockedHint="Richiesto dalle policy WhatsApp: non disattivabile."
        />
        <SwitchSetting
          label="Escalation se l'AI è incerta"
          description="Se l'AI non trova la risposta, propone un operatore invece di improvvisare."
          checked={behavior.escalateOnUncertainty}
          recommended
          onChange={(v) => void save({ behavior: { escalateOnUncertainty: v } })}
        />
        <SwitchSetting
          label="Riassunto al passaggio"
          description="Al passaggio a umano l'AI allega riassunto: problema, dati, tentativi, umore."
          checked={behavior.handoffSummary}
          onChange={(v) => void save({ behavior: { handoffSummary: v } })}
        />
        <SliderSetting
          label="Massimo turni AI consecutivi"
          description="Dopo N risposte senza risoluzione la chat passa a un umano."
          value={behavior.maxAiTurns}
          min={3}
          max={20}
          unit="turni"
          onCommit={(v) => void save({ behavior: { maxAiTurns: v } })}
        />
        <div className="py-3">
          <RuleList
            title="Parole chiave di escalation"
            rules={behavior.escalationKeywords}
            onChange={(kw) => void save({ behavior: { escalationKeywords: kw } })}
            placeholder="Es. glutine, garanzia…"
            accent="red"
            maxRules={100}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Parole che passano subito a un umano (la risposta resta in bozza).
            Aggiungi termini del tuo settore.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="Memoria e guardrail">
        <SliderSetting
          label="Messaggi ricordati"
          description="Messaggi recenti che l'AI ricorda alla lettera; oltre 20 aumenta solo il costo."
          value={behavior.historyMessages}
          min={5}
          max={50}
          unit="msg"
          onCommit={(v) => void save({ behavior: { historyMessages: v } })}
        />
        <SwitchSetting
          label="Guardrail prezzi"
          description="L'AI cita solo prezzi del listino caricato. Mai stime o sconti improvvisati."
          checked={behavior.priceGuardrail}
          recommended
          onChange={(v) => void save({ behavior: { priceGuardrail: v } })}
        />

        <div className="pt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full min-h-[44px] items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <span className="font-medium">Istruzioni avanzate (per utenti esperti)</span>
            <ChevronDown size={15} className={advancedOpen ? "rotate-180" : ""} />
          </button>
          {advancedOpen && (
            <div className="mt-3 space-y-2">
              <AdviceCallout title="Cosa scrivere qui">
                <p>
                  Istruzioni libere aggiunte in coda al prompt del preset
                  (es. promozioni temporanee, eccezioni, procedure interne).
                  Per le regole semplici preferisci le liste fai/non-fare qui sopra.
                </p>
              </AdviceCallout>
              <textarea
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onBlur={() =>
                  customDraft !== behavior.customInstructions &&
                  void save({ behavior: { customInstructions: customDraft } })
                }
                rows={6}
                maxLength={4000}
                placeholder="Istruzioni aggiuntive per l'AI…"
                className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
              />
              <p className="text-right text-xs text-muted-foreground">
                {customDraft.length}/4000
              </p>
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
