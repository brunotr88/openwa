import { twMerge } from "tailwind-merge";

type Tone = "neutral" | "success" | "warn" | "danger" | "accent";

const tones: Record<Tone, string> = {
  neutral:
    "bg-muted text-muted-foreground dark:bg-white/10 dark:text-muted-foreground",
  success: "bg-primary/12 text-success-fg dark:bg-primary/20",
  warn: "bg-accent/18 text-warn-fg dark:bg-accent/22",
  danger: "bg-danger/12 text-danger-fg dark:bg-danger/22",
  accent: "bg-accent/18 text-warn-fg dark:bg-accent/22",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={twMerge(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

const dotTones: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-primary",
  warn: "bg-accent",
  danger: "bg-danger",
  accent: "bg-accent",
};

export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={twMerge("relative flex h-2 w-2", className)}>
      {pulse && (
        <span
          className={twMerge(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            dotTones[tone]
          )}
        />
      )}
      <span
        className={twMerge(
          "relative inline-flex h-2 w-2 rounded-full",
          dotTones[tone]
        )}
      />
    </span>
  );
}
