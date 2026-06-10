"use client";

/**
 * AdviceCallout — 💡 consiglio pratico espandibile (pattern Tidio Hub).
 */
import { useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";

export function AdviceCallout({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/8 p-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb size={16} className="text-accent" />
          {title}
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
