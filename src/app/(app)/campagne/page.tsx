"use client";

/**
 * Campagne: lista con progresso (inviati/totale) + creazione rapida.
 * L'invio è spalmato nel tempo dal worker (anti-ban): la campagna parte in
 * RUNNING e avanza un messaggio per tick.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";

interface CampaignRow {
  id: string;
  name: string;
  mode: string;
  status: string;
  totalRecipients: number;
  stats: { total: number; pending: number; sent: number; failed: number };
}

export default function CampagnePage() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/campaigns");
    if (r.ok) setRows((await r.json()).campaigns);
  }
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  async function create() {
    if (!name.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mode: "text", body, tags: [], launchNow: true }),
      });
      if (r.ok) {
        setOpen(false);
        setName("");
        setBody("");
        void load();
      } else {
        alert((await r.json().catch(() => ({}))).error ?? "errore");
      }
    } catch {
      alert("Errore di rete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-ink">Campagne</h1>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white"
        >
          <Plus size={16} />
          Nuova
        </button>
      </div>

      {open && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome campagna"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base md:text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Messaggio da inviare a tutti i contatti opt-in…"
            className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base md:text-sm"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Inviata solo ai contatti con consenso o che hanno già scritto. L&apos;invio è graduale
            (protezione anti-ban).
          </p>
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim() || !body.trim()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <Megaphone size={16} />
            Lancia campagna
          </button>
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {rows.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Nessuna campagna ancora.
          </li>
        )}
        {rows.map((c) => {
          const pct = c.stats.total ? Math.round((c.stats.sent / c.stats.total) * 100) : 0;
          return (
            <li key={c.id}>
              <Link
                href={`/campagne/${c.id}`}
                className="block rounded-2xl border border-border bg-surface p-4 hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.status}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.stats.sent}/{c.stats.total} inviati · {c.stats.pending} in coda · {c.stats.failed} falliti
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
