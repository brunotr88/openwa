"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", {
      email,
      password,
      totp,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("Credenziali non valide.");
      return;
    }
    router.push("/inbox");
  }

  const field =
    "w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base shadow-sm transition-colors focus:border-primary/50 md:text-sm";

  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo size={44} withWordmark={false} />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Bentornato
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Accedi alla tua console WhatsApp + AI.
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-lg"
        >
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className={field}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="totp" className="text-sm font-medium">
              Codice 2FA{" "}
              <span className="font-normal text-muted-foreground">(opzionale)</span>
            </label>
            <input
              id="totp"
              type="text"
              inputMode="numeric"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              placeholder="123456"
              className={`${field} font-mono tracking-[0.3em]`}
            />
          </div>

          {error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="min-h-[48px] w-full rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-fg shadow-sm transition-all hover:-translate-y-px hover:bg-primary-hover hover:shadow-md active:translate-y-0 disabled:translate-y-0 disabled:opacity-60"
          >
            {loading ? "Accesso…" : "Accedi"}
          </button>
        </form>

        <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          OpenWA · Console Operativa
        </p>
      </div>
    </main>
  );
}
