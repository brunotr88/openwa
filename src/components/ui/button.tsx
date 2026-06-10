import { forwardRef } from "react";
import { twMerge } from "tailwind-merge";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover hover:-translate-y-px hover:shadow-md active:translate-y-0",
  secondary:
    "border border-border bg-surface text-ink shadow-sm hover:border-primary/40 hover:bg-muted/60",
  ghost: "text-ink hover:bg-primary/10",
  destructive:
    "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};

const sizes: Record<Size, string> = {
  sm: "min-h-[36px] px-3 py-1.5 text-xs",
  md: "min-h-[44px] px-4 py-2 text-sm",
  lg: "min-h-[48px] px-6 py-3 text-sm",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, ...props }, ref) => (
    <button
      ref={ref}
      className={twMerge(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
);
Button.displayName = "Button";
