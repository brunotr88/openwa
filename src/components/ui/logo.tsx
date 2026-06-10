/** OpenWA wordmark + bubble/spark glyph. Server-safe (no client hooks). */
export function Logo({
  size = 28,
  withWordmark = true,
}: {
  size?: number;
  withWordmark?: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="grid shrink-0 place-items-center rounded-xl bg-primary text-primary-fg shadow-sm"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg
          viewBox="0 0 32 32"
          width={size * 0.62}
          height={size * 0.62}
          fill="none"
        >
          <path
            d="M9 8.5h12a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5h-6.4L11 25.2a.7.7 0 0 1-1.13-.55V21.5H9A3.5 3.5 0 0 1 5.5 18v-6A3.5 3.5 0 0 1 9 8.5Z"
            fill="currentColor"
          />
          <path
            d="M19.4 9.6c.26 1.6.9 2.24 2.5 2.5-1.6.26-2.24.9-2.5 2.5-.26-1.6-.9-2.24-2.5-2.5 1.6-.26 2.24-.9 2.5-2.5Z"
            fill="var(--accent)"
          />
          <circle cx="11" cy="15" r="1.35" fill="var(--primary)" />
          <circle cx="15.4" cy="15" r="1.35" fill="var(--primary)" />
        </svg>
      </span>
      {withWordmark && (
        <span className="font-display text-lg font-bold tracking-tight text-ink">
          Open<span className="text-primary">WA</span>
        </span>
      )}
    </span>
  );
}
