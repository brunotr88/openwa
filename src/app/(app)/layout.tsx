/**
 * App shell — sidebar nav (Inbox, Sessioni) + sign out.
 * Server component: interactivity limited to links and a signOut form action.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, Smartphone, LogOut } from "lucide-react";
import { auth, signOut } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside
        className="flex w-56 shrink-0 flex-col border-r p-4"
        style={{ background: "var(--muted)" }}
      >
        <div className="mb-6 px-2 font-display text-lg font-semibold">
          OpenWA
        </div>

        <nav className="flex flex-col gap-1 text-sm">
          <Link
            href="/inbox"
            className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-brand-600/10"
          >
            <Inbox size={16} />
            Inbox
          </Link>
          <Link
            href="/sessions"
            className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-brand-600/10"
          >
            <Smartphone size={16} />
            Sessioni
          </Link>
        </nav>

        <div className="mt-auto space-y-2">
          <p className="truncate px-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
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
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-brand-600/10"
            >
              <LogOut size={16} />
              Esci
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
