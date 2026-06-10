"use client";

/**
 * Interactive sessions UI: add number, QR pairing (poll every 3s),
 * stop and delete actions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface SessionItem {
  id: string;
  phoneLabel: string;
  status: "QR" | "CONNECTED" | "BANNED" | "OFFLINE";
  lastSeenAt: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<SessionItem["status"], string> = {
  CONNECTED: "bg-green-500/15 text-green-600",
  QR: "bg-amber-500/15 text-amber-600",
  BANNED: "bg-red-500/15 text-red-600",
  OFFLINE: "bg-gray-500/15 text-gray-500",
};

function StatusBadge({ status }: { status: SessionItem["status"] }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

function QrPanel({
  sessionId,
  onConnected,
}: {
  sessionId: string;
  onConnected: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();

    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/qr`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          status: string;
          qrCode: string | null;
        };
        if (stopped) return;
        setError(null);
        if (data.status === "CONNECTED") {
          setConnected(true);
          onConnectedRef.current();
          return; // stop polling
        }
        setQr(data.qrCode);
      } catch (e) {
        if (!stopped && !(e instanceof DOMException && e.name === "AbortError")) {
          setError("Gateway non raggiungibile, riprovo...");
        }
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    }

    let timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [sessionId]);

  if (connected) {
    return (
      <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-600">
        Numero collegato con successo.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code WhatsApp" className="h-56 w-56 rounded bg-white p-2" />
      ) : (
        <div className="flex h-56 w-56 items-center justify-center text-sm" style={{ color: "var(--muted-foreground)" }}>
          Generazione QR...
        </div>
      )}
      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        Apri WhatsApp → Dispositivi collegati → Collega un dispositivo
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function SessionsClient({
  initialSessions,
}: {
  initialSessions: SessionItem[];
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: SessionItem[] };
      setSessions(data.sessions);
    } catch {
      // ignore — next action will retry
    }
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneLabel: label }),
      });
      const data = (await res.json()) as { session?: { id: string }; error?: string };
      if (!res.ok || !data.session) {
        setError(data.error ?? "Errore nella creazione della sessione.");
        return;
      }
      setAdding(false);
      setLabel("");
      setPairingId(data.session.id);
      await refresh();
    } catch {
      setError("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  async function onStop(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/sessions/${id}/stop`, { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("Eliminare questa sessione? Richiederà una nuova scansione QR.")) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (pairingId === id) setPairingId(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {sessions.length} sessione/i
        </p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={busy}
        >
          {adding ? "Annulla" : "Aggiungi numero"}
        </button>
      </div>

      {adding && (
        <form onSubmit={onCreate} className="flex gap-2 rounded-lg border p-4">
          <input
            type="text"
            required
            minLength={1}
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Etichetta numero (es. Supporto)"
            className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !label.trim()}
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Creazione..." : "Crea"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <ul className="space-y-3">
        {sessions.map((s) => (
          <li key={s.id} className="rounded-lg border p-4" style={{ background: "var(--muted)" }}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.phoneLabel}</p>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {s.lastSeenAt
                    ? `Ultimo aggiornamento: ${new Date(s.lastSeenAt).toLocaleString("it-IT")}`
                    : `Creata: ${new Date(s.createdAt).toLocaleString("it-IT")}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={s.status} />
                {s.status !== "CONNECTED" && (
                  <button
                    type="button"
                    onClick={() => setPairingId(pairingId === s.id ? null : s.id)}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-brand-600/10"
                  >
                    {pairingId === s.id ? "Chiudi QR" : "Mostra QR"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onStop(s.id)}
                  disabled={busy}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-brand-600/10 disabled:opacity-60"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(s.id)}
                  disabled={busy}
                  className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-60"
                >
                  Elimina
                </button>
              </div>
            </div>

            {pairingId === s.id && (
              <div className="mt-4">
                <QrPanel
                  sessionId={s.id}
                  onConnected={() => {
                    void refresh();
                    router.refresh();
                  }}
                />
              </div>
            )}
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="rounded-lg border border-dashed p-8 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
            Nessuna sessione. Aggiungi un numero per iniziare.
          </li>
        )}
      </ul>
    </div>
  );
}
