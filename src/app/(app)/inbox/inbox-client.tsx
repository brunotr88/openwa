"use client";

/**
 * Minimal inbox: conversations list + thread view.
 * - polling refresh ~5s with AbortController
 * - DRAFT bubbles: editable textarea + "Approva e invia"
 * - mode toggle AUTO/COPILOT/MANUAL
 * - manual reply box
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
  AUTO: "bg-green-500/15 text-green-600",
  COPILOT: "bg-amber-500/15 text-amber-600",
  MANUAL: "bg-gray-500/15 text-gray-500",
};

function contactLabel(c: ContactInfo): string {
  return contactDisplayName(c);
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
    <div className="ml-auto w-full max-w-md space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
      <p className="text-xs font-medium text-amber-600">Bozza AI — da approvare</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full rounded-md border bg-transparent px-2 py-1 text-sm"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        type="button"
        onClick={approve}
        disabled={busy || !text.trim()}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
      >
        {busy ? "Invio..." : "Approva e invia"}
      </button>
    </div>
  );
}

function Thread({
  conversationId,
  onChanged,
}: {
  conversationId: string;
  onChanged: () => void;
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
      <div className="flex flex-1 items-center justify-center text-sm" style={{ color: "var(--muted-foreground)" }}>
        Caricamento...
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <p className="font-medium">{contactLabel(thread.contact)}</p>
          {contactPhoneLine(thread.contact) && (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {contactPhoneLine(thread.contact)}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-2 py-1 text-xs font-medium ${
                thread.mode === m ? MODE_STYLE[m] : "opacity-50 hover:opacity-100"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto py-4">
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
              className={`w-fit max-w-md rounded-lg px-3 py-2 text-sm ${
                m.direction === "IN"
                  ? "mr-auto border"
                  : "ml-auto bg-brand-600 text-white"
              }`}
              style={m.direction === "IN" ? { background: "var(--muted)" } : undefined}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p
                className={`mt-1 text-[10px] ${
                  m.direction === "IN" ? "" : "text-white/70"
                }`}
                style={m.direction === "IN" ? { color: "var(--muted-foreground)" } : undefined}
              >
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

      <form onSubmit={sendManual} className="flex gap-2 border-t pt-3">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Scrivi una risposta..."
          className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !reply.trim()}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "..." : "Invia"}
        </button>
      </form>
      {error && <p className="pt-1 text-xs text-red-500">{error}</p>}
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
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-brand-600/5 disabled:opacity-60"
      >
        {busy ? "Aggiornamento..." : "Aggiorna nomi/numeri"}
      </button>
      {msg && (
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {msg}
        </span>
      )}
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
      <div className="flex min-h-0 flex-1 gap-4">
      <aside className="w-72 shrink-0 overflow-y-auto rounded-lg border">
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelectedId(c.id)}
            className={`block w-full border-b px-3 py-3 text-left hover:bg-brand-600/5 ${
              selectedId === c.id ? "bg-brand-600/10" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{contactLabel(c.contact)}</p>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${MODE_STYLE[c.mode]}`}
              >
                {c.mode}
              </span>
            </div>
            <p className="mt-1 truncate text-xs" style={{ color: "var(--muted-foreground)" }}>
              {c.lastMessage?.status === "DRAFT" && "✎ Bozza: "}
              {c.lastMessage?.body ?? "—"}
            </p>
          </button>
        ))}
        {loaded && conversations.length === 0 && (
          <p className="p-4 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
            Nessuna conversazione.
          </p>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-lg border p-4">
        {selectedId ? (
          <Thread
            key={selectedId}
            conversationId={selectedId}
            onChanged={() => void refresh()}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm" style={{ color: "var(--muted-foreground)" }}>
            Seleziona una conversazione.
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
