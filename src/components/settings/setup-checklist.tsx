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
    <div className="overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/8 to-accent/8 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-display text-sm font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-fg">
              <Rocket size={14} />
            </span>
            Completa la configurazione del bot
            <span className="font-mono text-xs text-muted-foreground">
              {doneCount}/{items.length}
            </span>
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {items.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-xs">
                {item.done ? (
                  <CheckCircle2 size={14} className="text-primary" />
                ) : (
                  <Circle size={14} className="opacity-40" />
                )}
                <span className={item.done ? "text-muted-foreground line-through" : ""}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Link
          href="/setup"
          className="flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-sm transition-all hover:-translate-y-px hover:bg-primary-hover hover:shadow-md"
        >
          Continua il setup
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
