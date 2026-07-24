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
  const { tenantId, sessionId, settings, save } = useSettings();
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
          sessionId,
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
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30 backdrop-blur-sm">
      <div
        className="ow-fade flex h-full w-full max-w-md flex-col border-l border-border bg-bg shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Prova il bot"
      >
        {/* Header stile WhatsApp */}
        <div className="flex items-center justify-between gap-2 border-b border-border bg-primary/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-fg">
              <Bot size={18} />
            </span>
            <div>
              <p className="font-display text-sm font-semibold">{botName}</p>
              <p className="text-xs text-muted-foreground">
                {busy ? "sta scrivendo…" : "Anteprima, nessun messaggio reale"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi playground"
            className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-primary/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Thread */}
        <div className="flex-1 space-y-3 overflow-y-auto bg-muted p-4">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Scrivi come farebbe un tuo cliente: il bot risponde con le
              impostazioni correnti (anche non salvate).
            </p>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="mr-12 w-fit max-w-[85%] rounded-2xl rounded-tl-md border border-border bg-surface px-3 py-2 text-sm text-ink shadow-sm">
                {m.content}
              </div>
            ) : (
              <div key={i} className="ml-12 space-y-1">
                <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-primary px-3 py-2 text-sm text-primary-fg shadow-sm">
                  {m.content}
                  <span className="ml-2 align-bottom text-[10px] opacity-75">✓✓</span>
                </div>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    aria-label="Risposta buona"
                    onClick={() => feedback(i, "up")}
                    className={`rounded-lg p-1.5 ${m.feedback === "up" ? "bg-primary/20 text-success-fg" : "opacity-50 hover:opacity-100"}`}
                  >
                    <ThumbsUp size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Risposta da correggere"
                    onClick={() => feedback(i, "down")}
                    className={`rounded-lg p-1.5 ${m.feedback === "down" ? "bg-danger/20 text-danger" : "opacity-50 hover:opacity-100"}`}
                  >
                    <ThumbsDown size={13} />
                  </button>
                </div>
                {fixIndex === i && (
                  <div className="ml-auto w-full max-w-[85%] space-y-2 rounded-xl border border-accent/45 bg-accent/12 p-2.5">
                    <p className="text-xs font-semibold text-warn-fg">
                      Correggi il bot: aggiungi una regola &quot;da non fare&quot;
                    </p>
                    <input
                      type="text"
                      value={fixRule}
                      onChange={(e) => setFixRule(e.target.value)}
                      maxLength={300}
                      className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addDontRule}
                        className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-fg"
                      >
                        Aggiungi regola
                      </button>
                      <button
                        type="button"
                        onClick={() => setFixIndex(null)}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs"
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
            <div className="ml-auto w-fit rounded-2xl rounded-tr-md bg-primary/50 px-3 py-2 text-sm text-primary-fg">
              <span className="animate-pulse">sta scrivendo…</span>
            </div>
          )}
          {error && <p className="text-center text-xs text-danger">{error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* Chip domande di esempio */}
        {preset && messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2">
            {preset.exampleQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void send(q)}
                className="rounded-full border border-dashed border-border px-3 py-1 text-xs transition-colors hover:border-primary/40 hover:bg-primary/10"
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
          className="flex gap-2 border-t border-border p-3"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Scrivi come un cliente…"
            maxLength={2000}
            className="flex-1 rounded-full border border-border bg-surface px-4 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Invia"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-fg shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}
