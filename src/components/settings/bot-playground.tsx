"use client";

/**
 * BotPlayground (M4) — drawer con mockup WhatsApp per provare il bot.
 * - invia {messages, draftSettings} a POST /api/playground (MAI WhatsApp reale)
 * - chip con domande di esempio del preset
 * - 👍/👎 per risposta; 👎 apre un input precompilato "aggiungi regola
 *   non-fare" (pattern Tidio: dal test alla correzione in un click)
 */
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { getPreset } from "@/lib/settings/presets";
import { useSettings } from "./settings-context";

interface PlayMsg {
  role: "user" | "assistant";
  content: string;
  feedback?: "up" | "down";
}

export function BotPlayground({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { tenantId, settings, save } = useSettings();
  const [messages, setMessages] = useState<PlayMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixIndex, setFixIndex] = useState<number | null>(null);
  const [fixRule, setFixRule] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const preset = getPreset(settings.persona.presetId);
  const botName = settings.persona.botName.trim() || "Il tuo bot";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  if (!open) return null;

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    setDraft("");
    const next: PlayMsg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          draftSettings: settings,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!res.ok || !data.text) {
        setError(data.error === "rate limited" ? "Troppe richieste, attendi un minuto." : "Generazione fallita. Riprova.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.text as string }]);
    } catch {
      setError("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  function feedback(index: number, value: "up" | "down") {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, feedback: value } : m))
    );
    if (value === "down") {
      setFixIndex(index);
      setFixRule("Non ");
    } else if (fixIndex === index) {
      setFixIndex(null);
    }
  }

  async function addDontRule() {
    const rule = fixRule.trim();
    if (!rule || rule.toLowerCase() === "non") return;
    await save({
      behavior: { dontRules: [...settings.behavior.dontRules, rule] },
    });
    setFixIndex(null);
    setFixRule("");
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div
        className="flex h-full w-full max-w-md flex-col border-l shadow-xl"
        style={{ background: "var(--background)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Prova il bot"
      >
        {/* Header stile WhatsApp */}
        <div className="flex items-center justify-between gap-2 border-b bg-brand-600/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white">
              <Bot size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold">{botName}</p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                {busy ? "sta scrivendo…" : "Anteprima — nessun messaggio reale"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi playground"
            className="rounded-md p-1.5 hover:bg-brand-600/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Thread */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ background: "var(--muted)" }}>
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
              Scrivi come farebbe un tuo cliente: il bot risponde con le
              impostazioni correnti (anche non salvate).
            </p>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="mr-12 w-fit max-w-[85%] rounded-lg rounded-tl-none border bg-white px-3 py-2 text-sm text-gray-900 shadow-sm dark:bg-gray-200">
                {m.content}
              </div>
            ) : (
              <div key={i} className="ml-12 space-y-1">
                <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-green-600/90 px-3 py-2 text-sm text-white shadow-sm">
                  {m.content}
                  <span className="ml-2 align-bottom text-[10px] opacity-75">✓✓</span>
                </div>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    aria-label="Risposta buona"
                    onClick={() => feedback(i, "up")}
                    className={`rounded-md p-1 ${m.feedback === "up" ? "bg-green-500/20 text-green-600" : "opacity-50 hover:opacity-100"}`}
                  >
                    <ThumbsUp size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Risposta da correggere"
                    onClick={() => feedback(i, "down")}
                    className={`rounded-md p-1 ${m.feedback === "down" ? "bg-red-500/20 text-red-600" : "opacity-50 hover:opacity-100"}`}
                  >
                    <ThumbsDown size={13} />
                  </button>
                </div>
                {fixIndex === i && (
                  <div className="ml-auto w-full max-w-[85%] space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
                    <p className="text-xs font-medium text-amber-600">
                      Correggi il bot: aggiungi una regola &quot;da non fare&quot;
                    </p>
                    <input
                      type="text"
                      value={fixRule}
                      onChange={(e) => setFixRule(e.target.value)}
                      maxLength={300}
                      className="w-full rounded-md border bg-transparent px-2 py-1.5 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addDontRule}
                        className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white"
                      >
                        Aggiungi regola
                      </button>
                      <button
                        type="button"
                        onClick={() => setFixIndex(null)}
                        className="rounded-md border px-2 py-1 text-xs"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          )}

          {busy && (
            <div className="ml-auto w-fit rounded-lg bg-green-600/40 px-3 py-2 text-sm text-white">
              <span className="animate-pulse">sta scrivendo…</span>
            </div>
          )}
          {error && <p className="text-center text-xs text-red-500">{error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* Chip domande di esempio */}
        {preset && messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5 border-t px-4 py-2">
            {preset.exampleQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void send(q)}
                className="rounded-full border border-dashed px-3 py-1 text-xs hover:bg-brand-600/10"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="flex gap-2 border-t p-3"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Scrivi come un cliente…"
            maxLength={2000}
            className="flex-1 rounded-full border bg-transparent px-4 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Invia"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-50"
          >
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}
