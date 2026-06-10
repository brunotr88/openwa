/**
 * App shell — responsive:
 *  - Desktop (md+): fixed left sidebar (logo + nav + signOut at bottom).
 *  - Mobile: top bar (logo + page title) + fixed bottom tab nav.
 * Server component: interactivity limited to links and the signOut form action;
 * active-state nav is delegated to client components in app-nav.tsx.
 */
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
import { SidebarNav, MobileTitle, BottomTabNav } from "./app-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-5 md:flex">
        <div className="px-2">
          <Logo />
        </div>

        <div className="mt-8 flex-1">
          <SidebarNav />
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="truncate px-3 font-mono text-xs text-muted-foreground">
            {session.user.email}
          </p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <LogOut size={18} />
              Esci
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur md:hidden">
        <Logo size={26} withWordmark={false} />
        <MobileTitle />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            aria-label="Esci"
            className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <LogOut size={18} />
          </button>
        </form>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-8 md:pt-7">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      <BottomTabNav />
    </div>
  );
}
