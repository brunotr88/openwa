"use client";

/**
 * Conversazioni → Invio e protezione numero (anti-ban, whatsapp-ops.md).
 * Profili Prudente/Standard/Aggressivo come card con i valori; toggle
 * pericolosi con alert ambra/rosso; valori avanzati in accordion
 * (modificarli → profilo "Personalizzato").
 */
import { useEffect, useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { SEND_PROFILES } from "@/lib/settings/defaults";
import { useSettings } from "@/components/settings/settings-context";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { SwitchSetting } from "@/components/settings/switch-setting";
import { RiskyToggle } from "@/components/settings/risky-toggle";
import { PresetCardGroup } from "@/components/settings/preset-card-group";
import { AdviceCallout } from "@/components/settings/advice-callout";
import { ResetToRecommended } from "@/components/settings/reset-to-recommended";

function fmtDelay(minMs: number, maxMs: number): string {
  return `${minMs / 1000}-${maxMs / 1000} s`;
}

function NumberField({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  return (
    <input
      type="number"
      value={local}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local);
        if (!Number.isNaN(n) && n >= min && n <= max && n !== value) onCommit(n);
        else setLocal(String(value));
      }}
      className="w-28 rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
    />
  );
}

export default function InvioPage() {
  const { tenantId, settings, save } = useSettings();
  const { sending } = settings;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sentToday, setSentToday] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/settings?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sentToday?: number } | null) => {
        if (!cancelled && d && typeof d.sentToday === "number") setSentToday(d.sentToday);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  /** Modifica manuale di un valore avanzato → profilo Personalizzato. */
  function saveCustom(patch: Record<string, number>) {
    void save({ sending: { ...patch, sendProfile: "personalizzato" } });
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
            <ShieldCheck size={22} className="text-primary" />
            Invio e protezione numero
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Proteggiamo il tuo numero: ritmi e limiti che imitano un operatore
            umano. I bot solo-reattivi hanno un rischio ban &lt; 2%.
          </p>
        </div>
        <ResetToRecommended sections={["sending"]} />
      </header>

      {sentToday !== null && (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm shadow-sm">
          Oggi:{" "}
          <span className="font-mono font-semibold">
            {sentToday}/{sending.dailyCap}
          </span>{" "}
          messaggi inviati
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted-foreground/15">
            <div
              className={`h-full rounded-full transition-all ${sentToday / sending.dailyCap > 0.9 ? "bg-danger" : "bg-primary"}`}
              style={{ width: `${Math.min(100, (sentToday / sending.dailyCap) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <SettingsCard
        title="Profilo di invio"
        description="Modificando un valore avanzato il profilo diventa «Personalizzato»."
      >
        <div className="space-y-3 py-3">
          <PresetCardGroup
            value={sending.sendProfile}
            onChange={(profile) => {
              if (profile === "personalizzato") return;
              void save({ sending: { sendProfile: profile, ...SEND_PROFILES[profile] } });
            }}
            options={[
              {
                value: "prudente",
                title: "Prudente",
                subtitle: "Numeri nuovi o in rodaggio",
                values: [
                  { label: "Msg/giorno", value: String(SEND_PROFILES.prudente.dailyCap) },
                  { label: "Msg/ora", value: String(SEND_PROFILES.prudente.hourlyCap) },
                  { label: "Pausa tra msg", value: fmtDelay(SEND_PROFILES.prudente.delayMinMs, SEND_PROFILES.prudente.delayMaxMs) },
                ],
              },
              {
                value: "standard",
                title: "Standard",
                subtitle: "Numero attivo da 2+ settimane",
                recommended: true,
                values: [
                  { label: "Msg/giorno", value: String(SEND_PROFILES.standard.dailyCap) },
                  { label: "Msg/ora", value: String(SEND_PROFILES.standard.hourlyCap) },
                  { label: "Pausa tra msg", value: fmtDelay(SEND_PROFILES.standard.delayMinMs, SEND_PROFILES.standard.delayMaxMs) },
                ],
              },
              {
                value: "aggressivo",
                title: "Aggressivo",
                subtitle: "Solo numeri rodati, reply-rate >30%",
                values: [
                  { label: "Msg/giorno", value: String(SEND_PROFILES.aggressivo.dailyCap) },
                  { label: "Msg/ora", value: String(SEND_PROFILES.aggressivo.hourlyCap) },
                  { label: "Pausa tra msg", value: fmtDelay(SEND_PROFILES.aggressivo.delayMinMs, SEND_PROFILES.aggressivo.delayMaxMs) },
                ],
              },
            ]}
          />
          {sending.sendProfile === "personalizzato" && (
            <p className="text-xs font-semibold text-warn-fg">
              Profilo personalizzato attivo — valori nella sezione avanzata.
            </p>
          )}

          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full min-h-[44px] items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <span className="font-medium">Valori avanzati</span>
            <ChevronDown size={15} className={advancedOpen ? "rotate-180" : ""} />
          </button>
          {advancedOpen && (
            <div>
              <SettingRow
                label="Tetto giornaliero"
                description="Superarlo non invia più nulla fino a domani: meglio un cliente in attesa che un numero bannato."
              >
                <NumberField
                  value={sending.dailyCap}
                  min={10}
                  max={5000}
                  onCommit={(v) => saveCustom({ dailyCap: v })}
                />
              </SettingRow>
              <SettingRow label="Tetto orario" description="Limite massimo di messaggi per ora (incluse le risposte).">
                <NumberField
                  value={sending.hourlyCap}
                  min={5}
                  max={1000}
                  onCommit={(v) => saveCustom({ hourlyCap: v })}
                />
              </SettingRow>
              <SettingRow label="Pausa minima (ms)" description="Non scendere sotto 2000 ms: i ritmi troppo rapidi sono il segnale bot più evidente.">
                <NumberField
                  value={sending.delayMinMs}
                  min={1500}
                  max={60000}
                  step={500}
                  onCommit={(v) => saveCustom({ delayMinMs: v })}
                />
              </SettingRow>
              <SettingRow label="Pausa massima (ms)" description="Ritardo massimo casuale prima di ogni risposta (cap 10 s).">
                <NumberField
                  value={sending.delayMaxMs}
                  min={1500}
                  max={60000}
                  step={500}
                  onCommit={(v) => saveCustom({ delayMaxMs: v })}
                />
              </SettingRow>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Protezioni anti-ban">
        <RiskyToggle
          label="Rispondi solo a chi ti scrive"
          description="Il bot risponde solo a chi ti scrive: è la modalità più sicura (rischio ban < 2%). Disattivala solo per campagne a contatti che hanno dato consenso."
          checked={sending.replyOnlyMode}
          onChange={(v) => void save({ sending: { replyOnlyMode: v } })}
          severity="red"
          riskyWhen="off"
          warning="Modalità outbound attiva: l'invio proattivo a freddo ha un ban-rate del 15-30% l'anno, con ban permanente senza appello."
          confirmText="Stai per consentire invii proattivi. L'outreach a freddo è la prima causa di ban permanente. Confermi di avere solo contatti con consenso esplicito?"
          recommended
        />
        <RiskyToggle
          label="Rodaggio numero (warm-up)"
          description="Numero in rodaggio: i limiti giornalieri crescono gradualmente per 2 settimane. Forzare l'invio ora è la causa n.1 di ban."
          checked={sending.warmupMode}
          onChange={(v) => void save({ sending: { warmupMode: v } })}
          severity="amber"
          riskyWhen="off"
          warning="Warm-up disattivato: su un numero recente i volumi pieni da subito sono la causa n.1 di ban nei primi 10 giorni."
          recommended
        />
        <RiskyToggle
          label="Ritardo casuale tra risposte"
          description="Ritardo casuale tra le risposte per simulare un operatore umano. Non scendere sotto 2 secondi."
          checked={sending.randomDelay}
          onChange={(v) => void save({ sending: { randomDelay: v } })}
          severity="amber"
          riskyWhen="off"
          warning="Senza ritardo le risposte istantanee a raffica sono un chiaro segnale bot per i sistemi anti-spam."
          recommended
        />
        <SwitchSetting
          label="Indicatore «sta scrivendo…»"
          description="Mostra 'sta scrivendo…' prima di rispondere: rende il bot indistinguibile da un operatore e migliora l'esperienza."
          checked={sending.typingIndicator}
          recommended
          onChange={(v) => void save({ sending: { typingIndicator: v } })}
        />
        <SwitchSetting
          label="Outbound solo in orario lavorativo"
          description="Le campagne partono solo in orario lavorativo (es. 9-19): invii notturni sono un forte segnale spam. Le risposte ai clienti restano sempre attive."
          checked={sending.businessHoursOnlyOutbound}
          recommended
          onChange={(v) => void save({ sending: { businessHoursOnlyOutbound: v } })}
        />
        <RiskyToggle
          label="Risposte automatiche nei gruppi"
          description="Aggiungere persone a gruppi o scrivere in gruppi via bot è tra le cause di ban più segnalate: tenerlo spento."
          checked={sending.groupAutoReply}
          onChange={(v) => void save({ sending: { groupAutoReply: v } })}
          severity="red"
          riskyWhen="on"
          warning="Automazione nei gruppi attiva: è tra le cause di ban più segnalate dalla community."
          confirmText="Scrivere in gruppi via bot è tra le cause di ban più documentate. Confermi di voler attivare le risposte automatiche nei gruppi?"
        />
        <SwitchSetting
          label="Pausa automatica sui segnali di rischio"
          description="Se compaiono segnali di rischio (disconnessioni ripetute, reply-rate basso), l'invio outbound si ferma da solo e ti avvisiamo."
          checked={sending.pauseOnRisk}
          recommended
          onChange={(v) => void save({ sending: { pauseOnRisk: v } })}
        />
      </SettingsCard>

      <AdviceCallout title="Come funziona il warm-up" defaultOpen>
        <p>
          Un numero nuovo parte da ~20 messaggi al giorno e cresce gradualmente
          (35 → 65 → 115 → 210 → 380 → 680) fino a regime in ~2 settimane.
          I primi 10 giorni sono il periodo a rischio massimo: niente campagne,
          solo risposte. Se il numero resta inattivo per più di 72 ore, il
          rodaggio riparte 2-3 gradini indietro.
        </p>
      </AdviceCallout>
    </div>
  );
}
