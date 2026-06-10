import { twMerge } from "tailwind-merge";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        "rounded-2xl border border-border bg-surface shadow-sm",
        className
      )}
      {...props}
    />
  );
}
