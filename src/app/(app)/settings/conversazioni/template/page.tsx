"use client";

/**
 * Settings → Conversazioni → Template: editor di template testuali con
 * placeholder {{nome}}. I template alimentano API (mode=template) e campagne.
 */
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SettingsCard } from "@/components/settings/setting-row";
import { extractVariables } from "@/lib/outbound/template";

interface Tpl {
  id: string;
  name: string;
  body: string;
  variables: string[];
  updatedAt: string;
}

export default function TemplatePage() {
  const [list, setList] = useState<Tpl[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  async function load() {
    const r = await fetch("/api/templates");
    if (r.ok) setList((await r.json()).templates);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!name.trim() || !body.trim()) return;
    const r = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), body }),
    });
    if (r.ok) {
      setName("");
      setBody("");
      void load();
    } else {
      alert((await r.json()).error ?? "errore");
    }
  }

  async function remove(id: string) {
    if (!confirm("Eliminare il template?")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    void load();
  }

  const previewVars = extractVariables(body);

  return (
    <div className="space-y-6">
      <SettingsCard title="Nuovo template" description="Usa {{nome}} per i campi dinamici. {{nome}} è compilato dal contatto.">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome template (es. promemoria-ritiro)"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Ciao {{nome}}, il tuo {{prodotto}} è pronto per il ritiro."
          className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
        />
        {previewVars.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Variabili: {previewVars.map((v) => <code key={v} className="mr-1">{`{{${v}}}`}</code>)}
          </p>
        )}
        <button
          type="button"
          onClick={create}
          disabled={!name.trim() || !body.trim()}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Plus size={16} />
          Crea template
        </button>
      </SettingsCard>

      <SettingsCard title="Template salvati">
        <ul className="divide-y divide-border">
          {list.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">Nessun template.</li>
          )}
          {list.map((t) => (
            <li key={t.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{t.name}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{t.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="shrink-0 rounded-lg border border-border p-2 text-red-600 hover:bg-red-50"
                  aria-label="Elimina"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
}
