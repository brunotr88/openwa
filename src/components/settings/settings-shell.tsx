"use client";

/**
 * SettingsShell — 2 colonne: sotto-nav sticky a sinistra (gruppi per
 * job-to-be-done, voci 🔜 disabilitate) + contenuto. Pulsante globale
 * "Prova il bot" che apre il playground, toast di salvataggio.
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
  MessageCircle,
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
      <div className="flex gap-8">
        <aside className="w-60 shrink-0">
          <div className="sticky top-6 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h1 className="font-display text-xl font-semibold">Impostazioni</h1>
            </div>

            <button
              type="button"
              onClick={() => setPlaygroundOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              <Play size={14} />
              Prova il bot
            </button>

            <nav className="space-y-5">
              {NAV.map((group) => (
                <div key={group.group}>
                  <p
                    className="mb-1.5 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {group.group === "Conversazioni" && <MessageCircle size={11} />}
                    {group.group}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) =>
                      item.soon || !item.href ? (
                        <li
                          key={item.label}
                          className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm opacity-50"
                          title="In arrivo"
                        >
                          {item.icon}
                          <span className="flex-1">{item.label}</span>
                          <span className="rounded-full border px-1.5 py-0.5 text-[10px]">
                            🔜
                          </span>
                        </li>
                      ) : (
                        <li key={item.label}>
                          <Link
                            href={item.href}
                            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                              pathname === item.href
                                ? "bg-brand-600/10 font-medium text-brand-600"
                                : "hover:bg-brand-600/5"
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
