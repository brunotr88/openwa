"use client";

/**
 * Agente AI → Profilo e persona: chi è il bot (preset settore, identità,
 * tono, registro, emoji, lingua). Helper text dalle tabelle di ricerca.
 */
import { useState } from "react";
import {
  BedDouble,
  Dumbbell,
  Home,
  Scale,
  ShoppingCart,
  Sparkles,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { BUSINESS_PRESETS, getPreset } from "@/lib/settings/presets";
import type { Tone } from "@/lib/settings/schema";
import { useSettings } from "@/components/settings/settings-context";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { SegmentedControl } from "@/components/settings/segmented-control";
import { AdviceCallout } from "@/components/settings/advice-callout";
import { RecommendedBadge } from "@/components/settings/recommended-badge";

const PRESET_ICONS: Record<string, LucideIcon> = {
  UtensilsCrossed,
  ShoppingCart,
  Scale,
  Sparkles,
  Home,
  Wrench,
  BedDouble,
  Dumbbell,
};

const TONE_OPTIONS: Array<{
  value: Tone;
  label: string;
  description: string;
  preview: string;
}> = [
  {
    value: "professionale",
    label: "Professionale",
    description: "Cortese e diretto",
    preview: "Buongiorno! Certo, posso aiutarti subito con la tua richiesta.",
  },
  {
    value: "amichevole",
    label: "Amichevole",
    description: "Caloroso e informale",
    preview: "Ciao! 😊 Certo, ti aiuto volentieri: dimmi pure!",
  },
  {
    value: "entusiasta",
    label: "Entusiasta",
    description: "Energico e motivante",
    preview: "Ciao! Che bello sentirti 💪 Ti racconto subito tutto!",
  },
  {
    value: "formale",
    label: "Formale (Lei)",
    description: "Sobrio e istituzionale",
    preview: "Buongiorno. La ringrazio per averci contattato: resto a disposizione.",
  },
];

function TextField({
  value,
  onCommit,
  placeholder,
  maxLength,
  textarea,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  textarea?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const commit = () => {
    if (local !== value) onCommit(local);
  };
  const cls = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";
  return textarea ? (
    <textarea
      value={local}
      rows={4}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      className={cls}
    />
  ) : (
    <input
      type="text"
      value={local}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      className={cls}
    />
  );
}

export default function ProfiloPage() {
  const { settings, save } = useSettings();
  const { persona } = settings;
  const preset = getPreset(persona.presetId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Profilo e persona</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Chi è il tuo assistente: settore, identità e stile di comunicazione.
        </p>
      </header>

      <SettingsCard
        title="Tipo di attività"
        description="Scegli il settore: imposta tono, prompt e modello. Personalizzabile dopo."
      >
        <div className="grid gap-3 py-3 sm:grid-cols-2">
          {BUSINESS_PRESETS.map((p) => {
            const Icon = PRESET_ICONS[p.icon] ?? Sparkles;
            const active = persona.presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  void save({
                    persona: {
                      presetId: p.id,
                      tone: p.overrides.tone,
                      formality: p.overrides.formality,
                      emojiUsage: p.overrides.emojiUsage,
                    },
                    behavior: { responseStyle: p.overrides.responseStyle },
                  })
                }
                aria-pressed={active}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  active ? "border-brand-600 bg-brand-600/10" : "hover:bg-brand-600/5"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                    active ? "bg-brand-600 text-white" : "bg-brand-600/10 text-brand-600"
                  }`}
                >
                  <Icon size={16} />
                </span>
                <span>
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {p.tagline}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {preset && (
          <AdviceCallout title={`Consigli per ${preset.label}`} defaultOpen>
            <ul className="list-disc space-y-1 pl-4">
              {preset.consigli.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </AdviceCallout>
        )}
      </SettingsCard>

      <SettingsCard title="Identità">
        <SettingRow
          label="Nome del bot"
          description="Come si presenta l'assistente nei messaggi (es. Sofia, Marco)."
          stacked
        >
          <TextField
            value={persona.botName}
            maxLength={60}
            placeholder="Es. Sofia"
            onCommit={(v) => void save({ persona: { botName: v } })}
          />
        </SettingRow>
        <SettingRow
          label="Nome attività"
          description="Sostituisce i segnaposto del preset (es. «Sei l'assistente di …»)."
          stacked
        >
          <TextField
            value={persona.businessName}
            maxLength={120}
            placeholder="Es. Pizzeria Da Mario"
            onCommit={(v) => void save({ persona: { businessName: v } })}
          />
        </SettingRow>
        <SettingRow label="Città" description="Usata nella presentazione del bot (opzionale)." stacked>
          <TextField
            value={persona.city}
            maxLength={80}
            placeholder="Es. Bologna"
            onCommit={(v) => void save({ persona: { city: v } })}
          />
        </SettingRow>
        <SettingRow
          label="Descrizione dell'attività"
          description="L'AI risponde solo su ciò che scrivi qui e nella knowledge base."
          stacked
        >
          <TextField
            textarea
            value={persona.businessDescription}
            maxLength={2000}
            placeholder="Cosa fate, servizi, punti di forza, indirizzo, listino essenziale…"
            onCommit={(v) => void save({ persona: { businessDescription: v } })}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Stile di comunicazione">
        <SettingRow label="Tono" stacked>
          <div className="grid gap-2 sm:grid-cols-2">
            {TONE_OPTIONS.map((t) => {
              const active = persona.tone === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => void save({ persona: { tone: t.value } })}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active ? "border-brand-600 bg-brand-600/10" : "hover:bg-brand-600/5"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.label}</span>
                    {t.value === "professionale" && <RecommendedBadge />}
                  </div>
                  <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {t.description}
                  </p>
                  <p className="mt-2 rounded-md bg-green-600/10 px-2 py-1.5 text-xs italic">
                    “{t.preview}”
                  </p>
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow
          label="Registro (tu / Lei)"
          description="Il Lei non è mai un errore con clienti nuovi; «auto» si adegua al cliente."
          stacked
        >
          <SegmentedControl
            value={persona.formality}
            onChange={(v) => void save({ persona: { formality: v } })}
            options={[
              { value: "lei", label: "Lei", description: "Sempre formale" },
              { value: "tu", label: "Tu", description: "Sempre informale" },
              { value: "auto", label: "Auto", description: "Si adegua al cliente", recommended: true },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="Uso delle emoji"
          description="1-2 emoji rendono umano; di più è poco professionale."
          stacked
        >
          <SegmentedControl
            value={persona.emojiUsage}
            onChange={(v) => void save({ persona: { emojiUsage: v } })}
            options={[
              { value: "nessuna", label: "Nessuna", description: "Studio, IT, immobiliare" },
              { value: "moderata", label: "Moderata", description: "Max 1-2 per messaggio", recommended: true },
              { value: "libera", label: "Libera", description: "Tono molto informale" },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="Lingua principale"
          description="L'AI risponde comunque nella lingua del cliente quando diversa."
        >
          <select
            value={persona.language}
            onChange={(e) => void save({ persona: { language: e.target.value } })}
            className="rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
          </select>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
