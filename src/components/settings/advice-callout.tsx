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
    <div className="rounded-lg border border-brand-600/30 bg-brand-600/5 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Lightbulb size={15} className="text-brand-600" />
          {title}
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          {children}
        </div>
      )}
    </div>
  );
}
