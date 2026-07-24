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
  session: { id: string; phoneLabel: string } | null;
}

interface SessionOption {
  id: string;
  phoneLabel: string;
  status: string;
}

/** Legge il cookie condiviso col number-switcher delle Impostazioni, così la
 * scelta del numero resta coerente tra le due pagine. */
function readSessionCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.match(/(?:^|; )owa_settings_session=([^;]+)/)?.[1];
}

export default function CampagnePage() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/campaigns");
    if (r.ok) setRows((await r.json()).campaigns);
  }
  async function loadSessions() {
    const r = await fetch("/api/sessions");
    if (!r.ok) return;
    const list: SessionOption[] = (await r.json()).sessions ?? [];
    setSessions(list);
    setSessionId((prev) => {
      if (prev && list.some((s) => s.id === prev)) return prev;
      const cookieVal = readSessionCookie();
      if (cookieVal && list.some((s) => s.id === cookieVal)) return cookieVal;
      return list[0]?.id ?? "";
    });
  }
  useEffect(() => {
    void load();
    void loadSessions();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  function selectSession(id: string) {
    setSessionId(id);
    document.cookie = `owa_settings_session=${id}; path=/; max-age=31536000; samesite=lax; secure`;
  }

  async function create() {
    if (!name.trim() || !body.trim() || !sessionId) return;
    setBusy(true);
    try {
      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mode: "text",
          body,
          tags: [],
          launchNow: true,
          sessionId,
        }),
      });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        setOpen(false);
        setName("");
        setBody("");
        void load();
        if (data.launchError) {
          alert(
            `Campagna creata ma non lanciata: ${data.launchError}\nPuoi rilanciarla dalla lista campagne.`,
          );
        }
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
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Numero mittente
          </label>
          <select
            value={sessionId}
            onChange={(e) => selectSession(e.target.value)}
            className="mb-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base md:text-sm"
            aria-label="Numero mittente"
          >
            {sessions.length === 0 && <option value="">Nessun numero collegato</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.phoneLabel} ({s.status})
              </option>
            ))}
          </select>
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
            disabled={busy || !name.trim() || !body.trim() || !sessionId}
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
                  {c.session && <> · da {c.session.phoneLabel}</>}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
