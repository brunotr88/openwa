"use client";

/**
 * Conversazioni → Appuntamenti (M5): provider di prenotazione (Nessuno /
 * Calendly / Google Calendar), parametri degli slot e modalità di
 * prenotazione. Helper text su ogni impostazione.
 */
import { useState } from "react";
import { CheckCircle2, Link2, Loader2, XCircle } from "lucide-react";
import type { AppointmentsProvider } from "@/lib/settings/schema";
import { useSettings } from "@/components/settings/settings-context";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { SegmentedControl } from "@/components/settings/segmented-control";
import { SwitchSetting } from "@/components/settings/switch-setting";
import { AdviceCallout } from "@/components/settings/advice-callout";
import { PresetCardGroup } from "@/components/settings/preset-card-group";
import { ResetToRecommended } from "@/components/settings/reset-to-recommended";

// ─── Campi locali con commit on blur (pattern pagina Profilo) ───────────────

function TextField({
  value,
  onCommit,
  placeholder,
  maxLength,
  invalid,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
}) {
  const [local, setLocal] = useState(value);
  return (
    <input
      type="text"
      value={local}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local.trim());
      }}
      className={`w-full rounded-md border bg-transparent px-3 py-2 text-sm ${
        invalid ? "border-red-500" : ""
      }`}
    />
  );
}

function NumberField({
  value,
  onCommit,
  min,
  max,
  unit,
}: {
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  unit: string;
}) {
  const [local, setLocal] = useState(String(value));
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = Math.round(Number(local));
          if (!Number.isFinite(n) || n < min || n > max) {
            setLocal(String(value)); // ripristina
            return;
          }
          if (n !== value) onCommit(n);
          setLocal(String(n));
        }}
        className="w-24 rounded-md border bg-transparent px-3 py-2 text-sm"
      />
      <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        {unit}
      </span>
    </div>
  );
}

const CALENDLY_URL_RE = /^https:\/\/\S+$/;

/** Campo URL Calendly con validazione locale (salva solo URL validi). */
function CalendlyUrlField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const invalid = local.trim() !== "" && !CALENDLY_URL_RE.test(local.trim());
  return (
    <div>
      <input
        type="url"
        value={local}
        maxLength={300}
        placeholder="https://calendly.com/tuonome/30min"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const v = local.trim();
          if (v !== value && (v === "" || CALENDLY_URL_RE.test(v))) onCommit(v);
        }}
        className={`w-full rounded-md border bg-transparent px-3 py-2 text-sm ${
          invalid ? "border-red-500" : ""
        }`}
      />
      {invalid && (
        <p className="mt-1 text-xs text-red-600">
          URL non valido: deve iniziare con https:// (es. https://calendly.com/tuonome).
        </p>
      )}
    </div>
  );
}

export function AppuntamentiClient({ saEmail }: { saEmail: string | null }) {
  const { tenantId, settings, save } = useSettings();
  const appt = settings.appointments;

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  async function verifyConnection() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/appointments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          ...(appt.googleCalendarId ? { calendarId: appt.googleCalendarId } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        busyNext7Days?: number;
      };
      if (data.ok) {
        setVerifyResult({
          ok: true,
          message: `Collegamento riuscito: calendario raggiungibile (${data.busyNext7Days ?? 0} impegni nei prossimi 7 giorni).`,
        });
      } else {
        setVerifyResult({
          ok: false,
          message: data.error ?? "Verifica fallita: riprova tra qualche istante.",
        });
      }
    } catch {
      setVerifyResult({
        ok: false,
        message: "Verifica fallita: errore di rete, riprova.",
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Appuntamenti</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Come l&apos;AI gestisce le richieste di appuntamento dei clienti su WhatsApp.
          </p>
        </div>
        <ResetToRecommended
          sections={["appointments"]}
          keep={["provider", "calendlyUrl", "googleCalendarId"]}
        />
      </header>

      <SettingsCard
        title="Metodo di prenotazione"
        description="Da dove arriva la disponibilità e dove finisce la prenotazione."
      >
        <div className="py-3">
          <PresetCardGroup<AppointmentsProvider>
            value={appt.provider}
            onChange={(v) => {
              setVerifyResult(null);
              void save({ appointments: { provider: v } });
            }}
            options={[
              {
                value: "nessuno",
                title: "Nessuno",
                subtitle:
                  "L'AI non gestisce prenotazioni: raccoglie la richiesta e la passa a un operatore.",
                values: [],
              },
              {
                value: "calendly_link",
                title: "Link Calendly",
                subtitle:
                  "Zero configurazione: l'AI condivide il tuo link Calendly quando il cliente vuole un appuntamento.",
                values: [],
              },
              {
                value: "google_calendar",
                title: "Google Calendar",
                subtitle:
                  "L'AI controlla la disponibilità reale e prenota direttamente sul tuo calendario.",
                values: [],
              },
            ]}
          />
        </div>
      </SettingsCard>

      {appt.provider === "calendly_link" && (
        <SettingsCard
          title="Link Calendly"
          description="Il link che l'AI invierà in chat quando il cliente vuole prenotare."
        >
          <SettingRow
            label="URL Calendly"
            description="Es. https://calendly.com/tuonome/30min — deve iniziare con https://."
            stacked
          >
            <CalendlyUrlField
              value={appt.calendlyUrl}
              onCommit={(v) => void save({ appointments: { calendlyUrl: v } })}
            />
          </SettingRow>
          <AdviceCallout title="Come funziona" defaultOpen>
            <p>
              Quando il cliente chiede un appuntamento, l&apos;AI risponde con il tuo
              link Calendly: il cliente sceglie da solo l&apos;orario e la conferma
              arriva da Calendly. Nessun accesso al tuo calendario da parte della
              piattaforma.
            </p>
          </AdviceCallout>
        </SettingsCard>
      )}

      {appt.provider === "google_calendar" && (
        <>
          <SettingsCard
            title="Collegamento Google Calendar"
            description="L'AI legge gli impegni (liberi/occupati) e crea gli eventi sul calendario indicato."
          >
            <AdviceCallout title="Come collegare il tuo calendario (3 passi)" defaultOpen>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  Il tuo amministratore ha configurato l&apos;account di servizio:{" "}
                  <strong>
                    {saEmail ??
                      "(non ancora configurato — chiedi all'amministratore di impostare GOOGLE_SA_EMAIL)"}
                  </strong>
                  .
                </li>
                <li>
                  Apri Google Calendar → Impostazioni del calendario → Condividi con
                  persone specifiche → aggiungi quell&apos;email con permesso
                  &laquo;Apportare modifiche agli eventi&raquo;.
                </li>
                <li>
                  Copia l&apos;ID calendario (Impostazioni → Integra calendario) e
                  incollalo qui.
                </li>
              </ol>
            </AdviceCallout>

            <SettingRow
              label="ID calendario"
              description="Lo trovi in Google Calendar → Impostazioni → Integra calendario. Spesso è la tua email, o un ID tipo abc123@group.calendar.google.com."
              stacked
            >
              <TextField
                value={appt.googleCalendarId}
                maxLength={200}
                placeholder="nome@gmail.com oppure abc123@group.calendar.google.com"
                onCommit={(v) => {
                  setVerifyResult(null);
                  void save({ appointments: { googleCalendarId: v } });
                }}
              />
            </SettingRow>

            <div className="space-y-2 py-3">
              <button
                type="button"
                onClick={() => void verifyConnection()}
                disabled={verifying}
                className="inline-flex items-center gap-2 rounded-md border border-brand-600 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-600/5 disabled:opacity-60"
              >
                {verifying ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Link2 size={14} />
                )}
                Verifica collegamento
              </button>
              {verifyResult && (
                <p
                  className={`flex items-start gap-1.5 text-xs ${
                    verifyResult.ok ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {verifyResult.ok ? (
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={14} className="mt-0.5 shrink-0" />
                  )}
                  {verifyResult.message}
                </p>
              )}
            </div>
          </SettingsCard>

          <SettingsCard
            title="Slot e disponibilità"
            description="Gli slot proposti rispettano gli orari di attività (Conversazioni → Orari)."
          >
            <SettingRow
              label="Durata appuntamento"
              description="Quanto dura un appuntamento standard. Determina la dimensione degli slot proposti."
            >
              <NumberField
                value={appt.slotDurationMin}
                min={5}
                max={480}
                unit="minuti"
                onCommit={(v) => void save({ appointments: { slotDurationMin: v } })}
              />
            </SettingRow>
            <SettingRow
              label="Pausa tra appuntamenti"
              description="Cuscinetto tra un appuntamento e il successivo: tempo per prepararti o per gli imprevisti."
            >
              <NumberField
                value={appt.bufferMin}
                min={0}
                max={120}
                unit="minuti"
                onCommit={(v) => void save({ appointments: { bufferMin: v } })}
              />
            </SettingRow>
            <SettingRow
              label="Preavviso minimo"
              description="Quante ore di anticipo servono per prenotare: evita appuntamenti all'ultimo minuto."
            >
              <NumberField
                value={appt.minNoticeHours}
                min={0}
                max={168}
                unit="ore"
                onCommit={(v) => void save({ appointments: { minNoticeHours: v } })}
              />
            </SettingRow>
            <SettingRow
              label="Orizzonte di prenotazione"
              description="Fino a quanti giorni nel futuro l'AI può proporre e prenotare appuntamenti."
            >
              <NumberField
                value={appt.maxDaysAhead}
                min={1}
                max={90}
                unit="giorni"
                onCommit={(v) => void save({ appointments: { maxDaysAhead: v } })}
              />
            </SettingRow>
          </SettingsCard>

          <SettingsCard
            title="Modalità di prenotazione"
            description="Quanta autonomia ha l'AI nel fissare l'appuntamento."
          >
            <SettingRow label="Come prenota l'AI" stacked>
              <SegmentedControl
                value={appt.bookingMode}
                onChange={(v) => void save({ appointments: { bookingMode: v } })}
                options={[
                  {
                    value: "proponi",
                    label: "Proponi e conferma",
                    description:
                      "L'AI propone 2-3 slot e prenota solo dopo il sì esplicito del cliente in chat.",
                    recommended: true,
                  },
                  {
                    value: "prenota_diretto",
                    label: "Prenota subito",
                    description:
                      "Appena il cliente sceglie uno slot disponibile, l'AI prenota senza chiedere altro.",
                  },
                ]}
              />
            </SettingRow>

            <SwitchSetting
              label="Messaggio di conferma"
              description="Dopo la prenotazione l'AI invia un riepilogo con giorno, ora e nome."
              checked={appt.confirmationMessage}
              recommended
              onChange={(v) => void save({ appointments: { confirmationMessage: v } })}
            />
          </SettingsCard>
        </>
      )}
    </div>
  );
}
