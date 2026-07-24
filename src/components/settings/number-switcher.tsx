"use client";

/**
 * Selettore del numero da configurare — persiste la scelta in un cookie
 * (leggibile dal layout server) e ricarica i server component. Le
 * impostazioni sono per-numero (M5).
 */
import { useRouter } from "next/navigation";

export function NumberSwitcher({
  numbers,
  current,
}: {
  numbers: { id: string; phoneLabel: string; status: string }[];
  current: string;
}) {
  const router = useRouter();
  return (
    <select
      value={current}
      onChange={(e) => {
        document.cookie = `owa_settings_session=${e.target.value}; path=/; max-age=31536000; samesite=lax; secure`;
        router.refresh();
      }}
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
