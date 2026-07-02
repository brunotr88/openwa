"use client";

/**
 * Settings → Sviluppatori: gestione API key per l'API privata + esempi d'uso.
 * Il plaintext della key appena creata è mostrato una sola volta in un banner.
 */
import { useEffect, useState } from "react";
import { Copy, KeyRound, Trash2, Check } from "lucide-react";
import { SettingsCard } from "@/components/settings/setting-row";

interface ApiKeyRow {
  id: string;
  prefix: string;
  label: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  sessionId?: string;
  session?: { phoneLabel: string } | null;
}

export default function SviluppatoriPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [numbers, setNumbers] = useState<{ id: string; phoneLabel: string; status: string }[]>([]);
  const [sessionId, setSessionId] = useState<string>("");

  async function load() {
    const r = await fetch("/api/apikeys");
    if (r.ok) setKeys((await r.json()).keys);
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => {
        setNumbers(d.sessions ?? []);
        if (d.sessions?.[0]) setSessionId(d.sessions[0].id);
      })
      .catch(() => {});
  }, []);

  async function create() {
    if (!label.trim()) return;
    setLoading(true);
    try {
      const r = await fetch("/api/apikeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), scopes: ["messages:send"], sessionId }),
      });
      if (r.ok) {
        const data = await r.json();
        setCreated(data.plaintext);
        setLabel("");
        void load();
      } else {
        alert((await r.json().catch(() => ({}))).error ?? "errore");
      }
    } catch {
      alert("Errore di rete");
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revocare questa API key? Le app che la usano smetteranno di funzionare.")) return;
    const res = await fetch(`/api/apikeys/${id}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "errore");
    void load();
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="API key"
        description="Chiavi per l'API privata di invio (header X-Api-Key). Conserva la chiave: è mostrata una sola volta."
      >
        {created && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-medium text-ink">Nuova chiave creata — copiala ora</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg bg-surface px-3 py-2 text-xs">{created}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(created);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copiata" : "Copia"}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Etichetta (es. CRM interno)"
            className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
          />
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm md:text-sm"
            aria-label="Numero per la key"
          >
            {numbers.length === 0 && <option value="">Nessun numero collegato</option>}
            {numbers.map((n) => (
              <option key={n.id} value={n.id}>
                {n.phoneLabel} ({n.status})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={create}
            disabled={loading || !label.trim() || !sessionId}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <KeyRound size={16} />
            Crea key
          </button>
        </div>

        <ul className="mt-4 divide-y divide-border">
          {keys.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">Nessuna API key.</li>
          )}
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{k.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <code>{k.prefix}…</code> · numero {k.session?.phoneLabel ?? "—"} · {k.scopes.join(", ")} ·{" "}
                  {k.lastUsedAt ? `usata ${new Date(k.lastUsedAt).toLocaleDateString("it-IT")}` : "mai usata"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(k.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} />
                Revoca
              </button>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard title="Come si usa" description="Esempio di invio dalla tua applicazione.">
        <pre className="overflow-x-auto rounded-xl bg-ink/95 p-4 text-xs text-white">
{`curl -X POST https://openwa.isipc.com/api/v1/messages \\
  -H "X-Api-Key: owa_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+39333...",
    "mode": "text",
    "text": "Ciao, il tuo ordine è pronto",
    "optIn": true
  }'`}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">
          Modi: <code>text</code>, <code>template</code> (templateId + vars), <code>intent</code> (l&apos;AI
          compone). Risposta <code>202 {"{ jobId }"}</code>. Stato: <code>GET /api/v1/messages/&lt;jobId&gt;</code>.
        </p>
      </SettingsCard>
    </div>
  );
}
