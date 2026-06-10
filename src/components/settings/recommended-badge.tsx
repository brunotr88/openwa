"use client";

/** Badge "Consigliato" — fonte unica: recommendedDefaults (defaults.ts). */
export function RecommendedBadge({ label = "Consigliato" }: { label?: string }) {
  return (
    <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-600">
      {label}
    </span>
  );
}
