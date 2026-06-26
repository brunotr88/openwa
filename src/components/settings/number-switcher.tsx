"use client";

/**
 * Selettore del numero da configurare — naviga a ?sessionId=<id> preservando
 * il pathname corrente. Le impostazioni sono per-numero (M5).
 */
import { useRouter, usePathname } from "next/navigation";

export function NumberSwitcher({
  numbers,
  current,
}: {
  numbers: { id: string; phoneLabel: string; status: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      value={current}
      onChange={(e) => router.push(`${pathname}?sessionId=${e.target.value}`)}
      className="mb-3 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm shadow-sm"
      aria-label="Numero da configurare"
    >
      {numbers.map((n) => (
        <option key={n.id} value={n.id}>
          {n.phoneLabel} ({n.status})
        </option>
      ))}
    </select>
  );
}
