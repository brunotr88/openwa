"use client";

/**
 * Workspace → Generale: stato configurazione + reset completo ai consigliati.
 */
import Link from "next/link";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { useSettings } from "@/components/settings/settings-context";
import { SettingsCard } from "@/components/settings/setting-row";
import { ResetToRecommended } from "@/components/settings/reset-to-recommended";

export default function GeneralePage() {
  const { settings } = useSettings();

  const checklist: Array<{ label: string; done: boolean; href: string }> = [
    {
      label: "Tipo di attività scelto",
      done: settings.persona.presetId !== null,
      href: "/settings/agente/profilo",
    },
    {
      label: "Nome attività impostato",
      done: settings.persona.businessName.trim().length > 0,
      href: "/settings/agente/profilo",
    },
    {
      label: "Descrizione dell'attività compilata",
      done: settings.persona.businessDescription.trim().length > 0,
      href: "/settings/agente/profilo",
    },
    {
      label: "Bot attivo (Auto o Copilot)",
      done: settings.behavior.aiMode !== "OFF",
      href: "/settings/agente/comportamento",
    },
    {
      label: "Orari di attività configurati",
      done: settings.hours.schedule.some((d) => d.enabled),
      href: "/settings/conversazioni/orari",
    },
    {
      label: "Wizard di configurazione completato",
      done: settings.setup.completed,
      href: "/setup",
    },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Generale</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Stato della configurazione del workspace.
        </p>
      </header>

      <SettingsCard
        title="Completezza configurazione"
        description={`${doneCount}/${checklist.length} completati`}
      >
        <ul className="space-y-2 py-3">
          {checklist.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-brand-600/5"
              >
                {item.done ? (
                  <CheckCircle2 size={16} className="shrink-0 text-green-600" />
                ) : (
                  <Circle size={16} className="shrink-0 opacity-40" />
                )}
                <span className={item.done ? "" : "font-medium"}>{item.label}</span>
                <ExternalLink size={12} className="ml-auto opacity-40" />
              </Link>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard
        title="Ripristino"
        description="Riporta tutte le impostazioni del bot alla configurazione consigliata. I dati dell'attività (nome, descrizione, preset) vengono conservati."
      >
        <div className="py-3">
          <ResetToRecommended
            sections={["behavior", "hours", "sending", "inbox"]}
          />
        </div>
      </SettingsCard>
    </div>
  );
}
