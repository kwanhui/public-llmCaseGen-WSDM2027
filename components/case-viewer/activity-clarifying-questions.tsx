"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAutosave } from "./use-autosave";
import { setSessionList } from "./session-work";

interface Props {
  token: string;
  phaseId: string;
  initial: string[];
  readOnly: boolean;
}

export function ActivityClarifyingQuestions({ token, phaseId, initial, readOnly }: Props) {
  const [items, setItems] = useState<string[]>(
    initial.length > 0 ? initial : [""],
  );
  const save = useAutosave({
    token,
    phaseId,
    activityType: "clarifying_questions",
    enabled: !readOnly,
    hasStoredText: initial.some((q) => q.trim() !== ""),
  });

  useEffect(() => {
    setSessionList(phaseId, "clarifying_questions", items.filter((s) => s.trim() !== ""));
  }, [phaseId, items]);

  function schedule(next: string[]) {
    setItems(next);
    save.schedule({ items: next.map((s) => s.trim()).filter(Boolean) });
  }

  if (readOnly) {
    // A closed phase shows the questions written in it, and no empty box
    // when there are none.
    const cleaned = items.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return null;
    return (
      <div className="rounded-lg border bg-card px-4 py-3 shadow-xs">
        <h4 className="text-sm font-semibold">
          Clarifying questions
        </h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {cleaned.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-base font-semibold">Clarifying questions</h4>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Questions you would ask before going further. Press Enter for a new line.
      </p>
      <ol className="mt-3 space-y-2">
        {items.map((q, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-3 w-5 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">{i + 1}.</span>
            <Input
              value={q}
              onChange={(e) => {
                const next = items.slice();
                next[i] = e.target.value;
                schedule(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  schedule([...items.slice(0, i + 1), "", ...items.slice(i + 1)]);
                  // Focus next input on next tick.
                  requestAnimationFrame(() => {
                    const inputs = document.querySelectorAll<HTMLInputElement>(
                      ".cf-clarifying-input",
                    );
                    inputs[i + 1]?.focus();
                  });
                }
                if (e.key === "Backspace" && q === "" && items.length > 1) {
                  e.preventDefault();
                  schedule([...items.slice(0, i), ...items.slice(i + 1)]);
                }
              }}
              className="cf-clarifying-input h-11"
              aria-label={`Clarifying question ${i + 1}`}
              placeholder={i === 0 ? "e.g. a fact the scenario leaves out" : ""}
            />
          </li>
        ))}
      </ol>
      {save.status.kind === "failed" ? (
        <p className="mt-2 text-[13px] text-flag">
          {save.status.message}
        </p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 min-h-[44px] text-[13px]"
        onClick={() => schedule([...items, ""])}
      >
        Add question
      </Button>
    </div>
  );
}
