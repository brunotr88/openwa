"use client";

/**
 * SettingsShell — sotto-nav per gruppi job-to-be-done (voci 🔜 disabilitate)
 * + contenuto. Desktop: subnav sticky a sinistra. Mobile: chip row orizzontale
 * scrollabile in alto. Pulsante globale "Prova il bot" + toast di salvataggio.
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  Inbox,
  Play,
  Settings2,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
  Users,
  Webhook,
} from "lucide-react";
import type { TenantSettings } from "@/lib/settings/schema";
import { SettingsProvider, SaveToast } from "./settings-context";
import { BotPlayground } from "./bot-playground";

interface NavItem {
  label: string;
  href?: string;
  icon: React.ReactNode;
  soon?: boolean;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Agente AI",
    items: [
      { label: "Profilo e persona", href: "/settings/agente/profilo", icon: <Bot size={15} /> },
      { label: "Comportamento risposte", href: "/settings/agente/comportamento", icon: <SlidersHorizontal size={15} /> },
      { label: "Knowledge Base", icon: <BookOpen size={15} />, soon: true },
    ],
  },
  {
    group: "Conversazioni",
    items: [
      { label: "Orari e disponibilità", href: "/settings/conversazioni/orari", icon: <CalendarClock size={15} /> },
      { label: "Appuntamenti", href: "/settings/conversazioni/appuntamenti", icon: <CalendarCheck size={15} /> },
      { label: "Invio e protezione numero", href: "/settings/conversazioni/invio", icon: <ShieldCheck size={15} /> },
      { label: "Preferenze Inbox", href: "/settings/conversazioni/inbox", icon: <Inbox size={15} /> },
    ],
  },
  {
    group: "WhatsApp",
    items: [
      { label: "Sessioni e numeri", href: "/sessions", icon: <Smartphone size={15} /> },
    ],
  },
  {
    group: "Workspace",
    items: [
      { label: "Generale", href: "/settings/workspace/generale", icon: <Settings2 size={15} /> },
      { label: "Team", icon: <Users size={15} />, soon: true },
      { label: "API & Webhook", icon: <Webhook size={15} />, soon: true },
    ],
  },
];

const FLAT_ITEMS = NAV.flatMap((g) => g.items);

export function SettingsShell({
  tenantId,
  initialSettings,
  children,
}: {
  tenantId: string;
  initialSettings: TenantSettings;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [playgroundOpen, setPlaygroundOpen] = useState(false);

  return (
    <SettingsProvider tenantId={tenantId} initialSettings={initialSettings}>
      {/* Mobile: title + chip row */}
      <div className="mb-4 md:hidden">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="font-display text-xl font-bold tracking-tight">Impostazioni</h1>
          <button
            type="button"
            onClick={() => setPlaygroundOpen(true)}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg shadow-sm hover:bg-primary-hover"
          >
            <Play size={14} />
            Prova
          </button>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FLAT_ITEMS.map((item) =>
            item.soon || !item.href ? (
              <span
                key={item.label}
                className="flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs opacity-50"
              >
                {item.icon}
                {item.label} 🔜
              </span>
            ) : (
              <Link
                key={item.label}
                href={item.href}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  pathname === item.href
                    ? "border-primary bg-primary/12 text-primary"
                    : "border-border hover:border-primary/40 hover:bg-muted/60"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            )
          )}
        </div>
      </div>

      <div className="flex gap-8">
        {/* Desktop: sticky subnav */}
        <aside className="hidden w-60 shrink-0 md:block">
          <div className="sticky top-6 space-y-5">
            <h1 className="font-display text-xl font-bold tracking-tight">Impostazioni</h1>

            <button
              type="button"
              onClick={() => setPlaygroundOpen(true)}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-fg shadow-sm transition-all hover:-translate-y-px hover:bg-primary-hover hover:shadow-md"
            >
              <Play size={14} />
              Prova il bot
            </button>

            <nav className="space-y-5">
              {NAV.map((group) => (
                <div key={group.group}>
                  <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.group}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) =>
                      item.soon || !item.href ? (
                        <li
                          key={item.label}
                          className="flex cursor-not-allowed items-center gap-2 rounded-xl px-2.5 py-2 text-sm opacity-50"
                          title="In arrivo"
                        >
                          {item.icon}
                          <span className="flex-1">{item.label}</span>
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px]">
                            🔜
                          </span>
                        </li>
                      ) : (
                        <li key={item.label}>
                          <Link
                            href={item.href}
                            className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition-colors ${
                              pathname === item.href
                                ? "bg-primary/12 font-semibold text-primary"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-ink"
                            }`}
                          >
                            {item.icon}
                            {item.label}
                          </Link>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0 max-w-3xl flex-1 space-y-6 pb-16">{children}</div>
      </div>

      <BotPlayground open={playgroundOpen} onClose={() => setPlaygroundOpen(false)} />
      <SaveToast />
    </SettingsProvider>
  );
}
