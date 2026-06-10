"use client";

/**
 * Client nav pieces for the app shell: desktop sidebar links, mobile top-bar
 * title, and the fixed mobile bottom tab bar — all with active highlighting
 * via usePathname. No data/behavior here, purely presentational navigation.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Smartphone, Settings, type LucideIcon } from "lucide-react";

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match this path and any nested route. */
  match: (path: string) => boolean;
}

const NAV: NavLink[] = [
  {
    href: "/inbox",
    label: "Inbox",
    icon: Inbox,
    match: (p) => p === "/inbox" || p.startsWith("/inbox/"),
  },
  {
    href: "/sessions",
    label: "Sessioni",
    icon: Smartphone,
    match: (p) => p.startsWith("/sessions"),
  },
  {
    href: "/settings/agente/profilo",
    label: "Impostazioni",
    icon: Settings,
    match: (p) => p.startsWith("/settings") || p.startsWith("/setup"),
  },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:bg-muted/70 hover:text-ink"
            }`}
          >
            <Icon
              size={18}
              className={active ? "text-primary" : "text-muted-foreground group-hover:text-ink"}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileTitle() {
  const pathname = usePathname();
  const current = NAV.find((n) => n.match(pathname));
  return (
    <span className="font-display text-base font-semibold text-ink">
      {current?.label ?? "OpenWA"}
    </span>
  );
}

export function BottomTabNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`group flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors active:scale-95 ${
                active ? "text-primary" : "text-muted-foreground hover:text-ink"
              }`}
            >
              <span
                className={`flex h-7 items-center justify-center rounded-full px-3 transition-colors ${
                  active ? "bg-primary/12" : "group-hover:bg-muted/60"
                }`}
              >
                <Icon size={20} />
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
