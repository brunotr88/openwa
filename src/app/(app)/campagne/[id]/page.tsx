"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ban } from "lucide-react";

interface Detail {
  campaign: { id: string; name: string; mode: string; body: string | null; status: string; totalRecipients: number };
  stats: { total: number; pending: number; sent: number; failed: number };
}

export default function CampagnaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);

  async function load() {
    const r = await fetch(`/api/campaigns/${id}`);
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    void load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [id]);

  async function cancel() {
    if (!confirm("Annullare la campagna? I messaggi non ancora inviati verranno cancellati.")) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    void load();
  }

  if (!data) return <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>;
  const { campaign, stats } = data;
  const pct = stats.total ? Math.round((stats.sent / stats.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/campagne" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> Campagne
      </Link>
      <div className="mt-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-ink">{campaign.name}</h1>
        {(campaign.status === "RUNNING" || campaign.status === "DRAFT") && (
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-red-600 hover:bg-red-50"
          >
            <Ban size={14} /> Annulla
          </button>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold text-ink">{stats.sent}</p>
            <p className="text-xs text-muted-foreground">inviati</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-ink">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">in coda</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-ink">{stats.failed}</p>
            <p className="text-xs text-muted-foreground">falliti</p>
          </div>
        </div>
      </div>

      {campaign.body && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted-foreground">Messaggio</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{campaign.body}</p>
        </div>
      )}
    </div>
  );
}
