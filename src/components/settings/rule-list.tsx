"use client";

/**
 * RuleList — regole "fai/non fare" come chip (pattern Intercom Fin Guidance):
 * contatore + limite, esempi per settore come chip cliccabili.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";

const MAX_RULE_LENGTH = 300;

export function RuleList({
  title,
  rules,
  onChange,
  examples = [],
  maxRules = 20,
  placeholder,
  accent = "green",
}: {
  title: string;
  rules: string[];
  onChange: (next: string[]) => void;
  /** Esempi del preset corrente (chip cliccabili). */
  examples?: string[];
  maxRules?: number;
  placeholder?: string;
  accent?: "green" | "red";
}) {
  const [draft, setDraft] = useState("");

  function add(text: string) {
    const value = text.trim().slice(0, MAX_RULE_LENGTH);
    if (!value || rules.includes(value) || rules.length >= maxRules) return;
    onChange([...rules, value]);
    setDraft("");
  }

  const chipCls =
    accent === "green"
      ? "border-green-500/40 bg-green-500/10"
      : "border-red-500/40 bg-red-500/10";

  const visibleExamples = examples.filter((e) => !rules.includes(e));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {rules.length}/{maxRules}
        </span>
      </div>

      {rules.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {rules.map((rule) => (
            <li
              key={rule}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${chipCls}`}
            >
              <span>{rule}</span>
              <button
                type="button"
                aria-label={`Rimuovi: ${rule}`}
                onClick={() => onChange(rules.filter((r) => r !== rule))}
                className="opacity-60 hover:opacity-100"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={draft}
          maxLength={MAX_RULE_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder ?? "Aggiungi una regola…"}
          className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!draft.trim() || rules.length >= maxRules}
          className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-brand-600/10 disabled:opacity-50"
        >
          <Plus size={14} />
          Aggiungi
        </button>
      </form>

      {visibleExamples.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Esempi per il tuo settore — tocca per aggiungere:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {visibleExamples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => add(ex)}
                className="rounded-full border border-dashed px-3 py-1 text-xs hover:bg-brand-600/10"
              >
                + {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
