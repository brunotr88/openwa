"use client";

/**
 * Wizard di onboarding — 5 step, <5 minuti, riprendibile (dashboard-ux.md):
 * 1. Connetti WhatsApp (QR)  2. Tipo attività  3. Personalità
 * 4. Proteggi il numero      5. Prova il bot → "Attiva il bot 🚀"
 * Ogni step salva subito in TenantSettings; "Completa più tardi" sempre
 * disponibile.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Play,
  Rocket,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import type { TenantSettings } from "@/lib/settings/schema";
import { BUSINESS_PRESETS, getPreset } from "@/lib/settings/presets";
import { SEND_PROFILES } from "@/lib/settings/defaults";
import {
  SettingsProvider,
  SaveToast,
  useSettings,
} from "@/components/settings/settings-context";
import {
  PRESET_ICONS,
  FALLBACK_PRESET_ICON,
  TONE_OPTIONS,
} from "@/components/settings/persona-options";
import { PresetCardGroup } from "@/components/settings/preset-card-group";
import { BotPlayground } from "@/components/settings/bot-playground";
import { QrPanel } from "../sessions/sessions-client";

const STEP_TITLES = [
  "Connetti WhatsApp",
  "Che attività hai?",
  "Personalità del bot",
  "Proteggi il tuo numero",
  "Prova il tuo bot",
];

/** Timeline warm-up statica (whatsapp-ops.md, ramp giorno per giorno). */
const WARMUP_STEPS = [
  { label: "Giorno 1", cap: 20 },
  { label: "Giorno 3", cap: 65 },
  { label: "Giorno 5", cap: 210 },
  { label: "Giorno 7", cap: 680 },
  { label: "Giorno 15+", cap: 1000 },
];

function fmtDelay(minMs: number, maxMs: number): string {
  return `${minMs / 1000}-${maxMs / 1000} s`;
}

// ── Step 1: Connetti WhatsApp ────────────────────────────────────────────────

function ConnectStep({ hasConnectedSession }: { hasConnectedSession: boolean }) {
  const [connected, setConnected] = useState(hasConnectedSession);
  const [label, setLabel] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneLabel: label.trim() || "Principale" }),
      });
      const data = (await res.json()) as { session?: { id: string }; error?: string };
      if (!res.ok || !data.session) {
        setError(data.error ?? "Errore nella creazione della sessione.");
        return;
      }
      setSessionId(data.session.id);
    } catch {
      setError("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  if (connected) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-green-500/40 bg-green-500/10 p-8">
        <CheckCircle2 size={32} className="text-green-600" />
        <p className="text-sm font-medium text-green-600">
          WhatsApp collegato! Puoi passare al prossimo step.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
        Collega il numero WhatsApp della tua attività: scansiona il QR da
        WhatsApp → Dispositivi collegati → Collega un dispositivo. Consiglio:
        usa un numero già attivo da qualche settimana; i numeri appena
        registrati partono con limiti di invio prudenti.
      </p>

      {!sessionId ? (
        <form onSubmit={createSession} className="flex gap-2">
          <input
            type="text"
            value={label}
            maxLength={100}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Etichetta numero (es. Principale)"
            className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            <Smartphone size={14} />
            {busy ? "Creazione…" : "Genera QR"}
          </button>
        </form>
      ) : (
        <QrPanel sessionId={sessionId} onConnected={() => setConnected(true)} />
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

// ── Wizard ───────────────────────────────────────────────────────────────────

function Wizard({ hasConnectedSession }: { hasConnectedSession: boolean }) {
  const router = useRouter();
  const { settings, save } = useSettings();
  const [step, setStep] = useState(() =>
    Math.min(Math.max(settings.setup.step, 0), 4)
  );
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [activating, setActivating] = useState(false);

  const preset = getPreset(settings.persona.presetId);

  function goTo(next: number) {
    setStep(next);
    void save({ setup: { step: next } });
  }

  async function activate() {
    setActivating(true);
    await save({
      behavior: { aiMode: preset?.recommendedAiMode ?? "COPILOT" },
      setup: { completed: true, step: 5 },
    });
    router.push("/inbox");
  }

  const canProceed =
    step !== 1 || settings.persona.presetId !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold">
            {STEP_TITLES[step]}
          </h1>
          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Passo {step + 1} di 5
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-500/20">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${((step + 1) / 5) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="rounded-lg border p-6" style={{ background: "var(--muted)" }}>
        {step === 0 && <ConnectStep hasConnectedSession={hasConnectedSession} />}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Scegli il settore: imposta tono, prompt e modello del bot.
              Potrai personalizzare tutto dopo.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {BUSINESS_PRESETS.map((p) => {
                const Icon = PRESET_ICONS[p.icon] ?? FALLBACK_PRESET_ICON;
                const active = settings.persona.presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={active}
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Nome attività</label>
                <input
                  type="text"
                  defaultValue={settings.persona.businessName}
                  maxLength={120}
                  placeholder="Es. Pizzeria Da Mario"
                  onBlur={(e) =>
                    e.target.value !== settings.persona.businessName &&
                    void save({ persona: { businessName: e.target.value } })
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Città (opzionale)</label>
                <input
                  type="text"
                  defaultValue={settings.persona.city}
                  maxLength={80}
                  placeholder="Es. Bologna"
                  onBlur={(e) =>
                    e.target.value !== settings.persona.city &&
                    void save({ persona: { city: e.target.value } })
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <label className="mb-1 block text-sm font-medium">Nome del bot</label>
              <p className="mb-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                Come si presenta nei messaggi (es. Sofia, Marco).
              </p>
              <input
                type="text"
                defaultValue={settings.persona.botName}
                maxLength={60}
                placeholder="Es. Sofia"
                onBlur={(e) =>
                  e.target.value !== settings.persona.botName &&
                  void save({ persona: { botName: e.target.value } })
                }
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Tono</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {TONE_OPTIONS.map((t) => {
                  const active = settings.persona.tone === t.value;
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
                      <p className="text-sm font-medium">{t.label}</p>
                      <p className="mt-1 rounded-md bg-green-600/10 px-2 py-1.5 text-xs italic">
                        “{t.preview}”
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Descrizione dell&apos;attività
              </label>
              <p className="mb-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                L&apos;AI risponde solo su ciò che scrivi qui: servizi, orari,
                listino essenziale, indirizzo.
              </p>
              <textarea
                defaultValue={settings.persona.businessDescription}
                rows={5}
                maxLength={2000}
                placeholder="Cosa fate, punti di forza, listino essenziale…"
                onBlur={(e) =>
                  e.target.value !== settings.persona.businessDescription &&
                  void save({ persona: { businessDescription: e.target.value } })
                }
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <p className="flex items-start gap-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-green-600" />
              I bot che rispondono solo a chi scrive hanno un rischio ban
              inferiore al 2%. Scegli quanto prudente vuoi essere: nessun
              numero da configurare a mano.
            </p>
            <PresetCardGroup
              value={settings.sending.sendProfile}
              onChange={(profile) => {
                if (profile === "personalizzato") return;
                void save({
                  sending: { sendProfile: profile, ...SEND_PROFILES[profile] },
                });
              }}
              options={[
                {
                  value: "prudente",
                  title: "Prudente",
                  subtitle: "Numero nuovo",
                  values: [
                    { label: "Msg/giorno", value: String(SEND_PROFILES.prudente.dailyCap) },
                    { label: "Pausa", value: fmtDelay(SEND_PROFILES.prudente.delayMinMs, SEND_PROFILES.prudente.delayMaxMs) },
                  ],
                },
                {
                  value: "standard",
                  title: "Standard",
                  subtitle: "Numero già attivo",
                  recommended: true,
                  values: [
                    { label: "Msg/giorno", value: String(SEND_PROFILES.standard.dailyCap) },
                    { label: "Pausa", value: fmtDelay(SEND_PROFILES.standard.delayMinMs, SEND_PROFILES.standard.delayMaxMs) },
                  ],
                },
                {
                  value: "aggressivo",
                  title: "Aggressivo",
                  subtitle: "Solo numeri rodati",
                  values: [
                    { label: "Msg/giorno", value: String(SEND_PROFILES.aggressivo.dailyCap) },
                    { label: "Pausa", value: fmtDelay(SEND_PROFILES.aggressivo.delayMinMs, SEND_PROFILES.aggressivo.delayMaxMs) },
                  ],
                },
              ]}
            />

            <div>
              <p className="mb-2 text-sm font-medium">
                Come cresce un numero in rodaggio (warm-up)
              </p>
              <div className="flex items-end gap-2">
                {WARMUP_STEPS.map((w) => (
                  <div key={w.label} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs font-medium">{w.cap}</span>
                    <div
                      className="w-full rounded-t-md bg-brand-600/70"
                      style={{ height: `${12 + (w.cap / 1000) * 60}px` }}
                    />
                    <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                      {w.label}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                Messaggi/giorno consentiti. I limiti crescono da soli: tu non
                devi fare nulla.
              </p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5 text-center">
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Fai qualche domanda al bot come farebbe un tuo cliente. Se una
              risposta non ti convince, usa 👎 per correggerla al volo.
            </p>
            <button
              type="button"
              onClick={() => setPlaygroundOpen(true)}
              className="mx-auto flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-brand-600/10"
            >
              <Play size={15} />
              Apri il playground
            </button>
            {preset && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {preset.exampleQuestions.slice(0, 3).map((q) => (
                  <span key={q} className="rounded-full border border-dashed px-3 py-1 text-xs">
                    {q}
                  </span>
                ))}
              </div>
            )}
            <div className="border-t pt-5">
              <button
                type="button"
                onClick={() => void activate()}
                disabled={activating}
                className="mx-auto flex items-center gap-2 rounded-md bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                <Rocket size={16} />
                {activating
                  ? "Attivazione…"
                  : `Attiva il bot in modalità ${preset?.recommendedAiMode === "AUTO" ? "Auto" : "Copilot"} 🚀`}
              </button>
              <p className="mt-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                {preset?.recommendedAiMode === "AUTO"
                  ? "Risponderà da solo. Puoi passare a Copilot (approvi ogni bozza) quando vuoi."
                  : "In Copilot approvi ogni bozza prima dell'invio. Passa ad Auto quando ti fidi."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/inbox"
          className="text-xs underline-offset-2 hover:underline"
          style={{ color: "var(--muted-foreground)" }}
        >
          Completa più tardi
        </Link>
        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => goTo(step - 1)}
              className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm hover:bg-brand-600/10"
            >
              <ArrowLeft size={14} />
              Indietro
            </button>
          )}
          {step < 4 && (
            <button
              type="button"
              onClick={() => goTo(step + 1)}
              disabled={!canProceed}
              className="flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Continua
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>

      <BotPlayground open={playgroundOpen} onClose={() => setPlaygroundOpen(false)} />
      <SaveToast />
    </div>
  );
}

export function SetupClient({
  tenantId,
  initialSettings,
  hasConnectedSession,
}: {
  tenantId: string;
  initialSettings: TenantSettings;
  hasConnectedSession: boolean;
}) {
  return (
    <SettingsProvider tenantId={tenantId} initialSettings={initialSettings}>
      <Wizard hasConnectedSession={hasConnectedSession} />
    </SettingsProvider>
  );
}
