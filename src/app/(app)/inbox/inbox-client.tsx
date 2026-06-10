"use client";

/**
 * Inbox: conversations list + thread view.
 * - polling refresh ~5s with AbortController
 * - DRAFT bubbles: editable textarea + "Approva e invia"
 * - mode toggle AUTO/COPILOT/MANUAL
 * - manual reply box
 * Responsive: desktop two-pane (list + thread); mobile single-pane where the
 * thread replaces the list when a conversation is selected (reuses selectedId).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquareDashed, RefreshCw, Send } from "lucide-react";
import { contactDisplayName, contactPhoneLine } from "@/lib/wa/contact-resolve";

type Mode = "AUTO" | "COPILOT" | "MANUAL";

interface ContactInfo {
  id: string;
  waId: string;
  name: string | null;
  phone: string | null;
}

interface ConversationListItem {
  id: string;
  mode: Mode;
  status: string;
  lastMessageAt: string | null;
  contact: ContactInfo;
  lastMessage: {
    body: string | null;
    direction: "IN" | "OUT";
    status: string;
  } | null;
}

interface ThreadMessage {
  id: string;
  direction: "IN" | "OUT";
  body: string | null;
  status: string;
  aiGenerated: boolean;
  source: string;
  createdAt: string;
}

interface ThreadData {
  id: string;
  mode: Mode;
  contact: ContactInfo;
  messages: ThreadMessage[];
}

const MODES: Mode[] = ["AUTO", "COPILOT", "MANUAL"];

const MODE_STYLE: Record<Mode, string> = {
  AUTO: "bg-primary/12 text-success-fg",
  COPILOT: "bg-accent/18 text-warn-fg",
  MANUAL: "bg-muted text-muted-foreground",
};

function contactLabel(c: ContactInfo): string {
  return contactDisplayName(c);
}

function Avatar({ label }: { label: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
      {initial}
    </span>
  );
}

function DraftBubble({
  message,
  onApproved,
}: {
  message: ThreadMessage;
  onApproved: () => void;
}) {
  const [text, setText] = useState(message.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/messages/${message.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Invio fallito.");
        return;
      }
      onApproved();
    } catch {
      setError("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-auto w-full max-w-md space-y-2 rounded-2xl rounded-br-md border-2 border-dashed border-accent/60 bg-accent/10 p-3.5 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-warn-fg">
        <MessageSquareDashed size={14} />
        Bozza AI da approvare
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-base md:text-sm"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="button"
        onClick={approve}
        disabled={busy || !text.trim()}
        className="flex min-h-[40px] items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-fg shadow-sm transition-all hover:bg-primary-hover disabled:opacity-60"
      >
        <Send size={13} />
        {busy ? "Invio…" : "Approva e invia"}
      </button>
    </div>
  );
}

function Thread({
  conversationId,
  onChanged,
  onBack,
}: {
  conversationId: string;
  onChanged: () => void;
  onBack?: () => void;
}) {
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageId = thread?.messages[thread.messages.length - 1]?.id;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        signal,
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { conversation: ThreadData };
      setThread(data.conversation);
    },
    [conversationId]
  );

  useEffect(() => {
    setThread(null);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        await load(controller.signal);
      } catch {
        // aborted or network error — keep last state
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]);

  async function setMode(mode: Mode) {
    if (!thread || mode === thread.mode) return;
    setThread({ ...thread, mode }); // optimistic
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }).catch(() => undefined);
    onChanged();
  }

  async function sendManual(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Invio fallito.");
        return;
      }
      setReply("");
      await load();
      onChanged();
    } catch {
      setError("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  if (!thread) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="space-y-1.5">
            <span className="block h-3.5 w-32 animate-pulse rounded bg-muted" />
            <span className="block h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="flex-1 space-y-3 px-4 py-4">
          <span className="block h-10 w-56 max-w-[70%] animate-pulse rounded-2xl rounded-bl-md bg-muted" />
          <span className="ml-auto block h-12 w-64 max-w-[75%] animate-pulse rounded-2xl rounded-br-md bg-muted" />
          <span className="block h-8 w-44 max-w-[60%] animate-pulse rounded-2xl rounded-bl-md bg-muted" />
        </div>
        <span className="sr-only">Caricamento conversazione…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Contact header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Torna alla lista"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted md:hidden"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <Avatar label={contactLabel(thread.contact)} />
          <div className="min-w-0">
            <p className="truncate font-display font-semibold">
              {contactLabel(thread.contact)}
            </p>
            {contactPhoneLine(thread.contact) && (
              <p className="truncate font-mono text-xs text-muted-foreground">
                {contactPhoneLine(thread.contact)}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={thread.mode === m}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors active:scale-95 ${
                thread.mode === m
                  ? MODE_STYLE[m]
                  : "text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {thread.messages.map((m) =>
          m.status === "DRAFT" ? (
            <DraftBubble
              key={m.id}
              message={m}
              onApproved={() => {
                void load();
                onChanged();
              }}
            />
          ) : (
            <div
              key={m.id}
              className={`w-fit max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm md:max-w-md ${
                m.direction === "IN"
                  ? "mr-auto rounded-bl-md border border-border bg-surface text-ink"
                  : "ml-auto rounded-br-md bg-primary/12 text-ink dark:bg-primary/20"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {new Date(m.createdAt).toLocaleTimeString("it-IT", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {m.aiGenerated && " · AI"}
                {m.direction === "OUT" && ` · ${m.status}`}
              </p>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={sendManual}
        className="flex items-center gap-2 border-t border-border px-3 py-3"
      >
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Scrivi una risposta…"
          className="flex-1 rounded-full border border-border bg-surface px-4 py-2.5 text-base shadow-sm transition-colors focus:border-primary/50 md:text-sm"
        />
        <button
          type="submit"
          disabled={busy || !reply.trim()}
          aria-label="Invia"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-fg shadow-sm transition-all hover:bg-primary-hover active:scale-95 disabled:opacity-50 disabled:active:scale-100"
        >
          <Send size={17} />
        </button>
      </form>
      {error && <p className="px-4 pb-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

function ResolveContactsButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/contacts/resolve", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        updated?: number;
        error?: string;
      };
      if (!res.ok) {
        setMsg(data.error ?? "Aggiornamento fallito.");
        return;
      }
      setMsg(`${data.updated ?? 0} contatti aggiornati.`);
      onDone();
    } catch {
      setMsg("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/60 disabled:opacity-60"
      >
        <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        {busy ? "Aggiornamento…" : "Aggiorna nomi/numeri"}
      </button>
    </div>
  );
}

export function InboxClient() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch("/api/conversations", { signal, cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { conversations: ConversationListItem[] };
    setConversations(data.conversations);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        await refresh(controller.signal);
      } catch {
        // aborted or network error
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex justify-end">
        <ResolveContactsButton onDone={() => void refresh()} />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        {/* Conversation list — hidden on mobile when a thread is open */}
        <aside
          className={`w-full shrink-0 overflow-y-auto border-border md:w-[360px] md:border-r ${
            selectedId ? "hidden md:block" : "block"
          }`}
        >
          {!loaded &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="flex items-center gap-3 border-b border-border px-3.5 py-3"
                aria-hidden="true"
              >
                <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block h-3.5 w-2/5 animate-pulse rounded bg-muted" />
                  <span className="block h-3 w-3/4 animate-pulse rounded bg-muted" />
                </span>
              </div>
            ))}
          {conversations.map((c) => {
            const active = selectedId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`flex w-full items-center gap-3 border-b border-border px-3.5 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 active:bg-primary/8 ${
                  active ? "bg-primary/8" : ""
                }`}
              >
                <Avatar label={contactLabel(c.contact)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {contactLabel(c.contact)}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${MODE_STYLE[c.mode]}`}
                    >
                      {c.mode}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {c.lastMessage?.status === "DRAFT" && (
                      <span className="font-semibold text-warn-fg">✎ Bozza: </span>
                    )}
                    {c.lastMessage?.body ?? "Nessun messaggio"}
                  </span>
                </span>
              </button>
            );
          })}
          {loaded && conversations.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                <MessageSquareDashed size={22} />
              </span>
              <p className="text-sm font-semibold text-ink">
                Ancora nessuna conversazione
              </p>
              <p className="max-w-[18rem] text-xs leading-relaxed text-muted-foreground">
                Quando un cliente scrive al tuo numero WhatsApp, la chat compare
                qui. Collega un numero in Sessioni per iniziare a ricevere
                messaggi.
              </p>
            </div>
          )}
        </aside>

        {/* Thread — full screen on mobile when selected */}
        <section
          className={`min-w-0 flex-1 flex-col ${
            selectedId ? "flex" : "hidden md:flex"
          }`}
        >
          {selectedId ? (
            <Thread
              key={selectedId}
              conversationId={selectedId}
              onChanged={() => void refresh()}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center gap-3 p-8 text-center md:flex">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Send size={22} />
              </span>
              <p className="text-sm text-muted-foreground">
                Seleziona una conversazione per iniziare.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
