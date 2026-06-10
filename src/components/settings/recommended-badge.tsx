"use client";

/** Badge "Consigliato" — fonte unica: recommendedDefaults (defaults.ts). */
export function RecommendedBadge({ label = "Consigliato" }: { label?: string }) {
  return (
    <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-fg">
      {label}
    </span>
  );
}
