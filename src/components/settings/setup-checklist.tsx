/**
 * SetupChecklist — widget post-onboarding (server-safe, niente hook):
 * mostrato in dashboard finché il wizard /setup non è completato.
 */
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Rocket } from "lucide-react";
import type { TenantSettings } from "@/lib/settings/schema";

export function SetupChecklist({
  settings,
  hasConnectedSession,
}: {
  settings: TenantSettings;
  hasConnectedSession: boolean;
}) {
  if (settings.setup.completed) return null;

  const items: Array<{ label: string; done: boolean }> = [
    { label: "Collega WhatsApp", done: hasConnectedSession },
    { label: "Scegli il tipo di attività", done: settings.persona.presetId !== null },
    {
      label: "Descrivi la tua attività",
      done: settings.persona.businessDescription.trim().length > 0,
    },
    { label: "Attiva il bot", done: settings.behavior.aiMode !== "OFF" && settings.setup.completed },
  ];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="rounded-lg border border-brand-600/40 bg-brand-600/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Rocket size={15} className="text-brand-600" />
            Completa la configurazione del bot ({doneCount}/{items.length})
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {items.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-xs">
                {item.done ? (
                  <CheckCircle2 size={13} className="text-green-600" />
                ) : (
                  <Circle size={13} className="opacity-40" />
                )}
                <span style={item.done ? { color: "var(--muted-foreground)" } : undefined}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Link
          href="/setup"
          className="flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Continua il setup
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
