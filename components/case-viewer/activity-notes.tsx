"use client";

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/input";
import { useAutosave } from "./use-autosave";
import { setSessionText } from "./session-work";

interface Props {
  token: string;
  phaseId: string;
  initial: string;
  readOnly: boolean;
  // The heading. At the answer phase it says the notes are not the answer.
  label?: string;
}

export function ActivityNotes({ token, phaseId, initial, readOnly, label = "Notes" }: Props) {
  const [text, setText] = useState(initial);
  const save = useAutosave({
    token,
    phaseId,
    activityType: "notes",
    enabled: !readOnly,
    hasStoredText: initial.trim() !== "",
  });

  useEffect(() => {
    setSessionText(phaseId, "notes", text);
  }, [phaseId, text]);

  function onChange(next: string) {
    setText(next);
    save.schedule({ text: next });
  }

  // A closed phase shows the notes written in it, and no empty box when there
  // are none.
  if (readOnly) {
    if (text.trim() === "") return null;
    return (
      <div className="rounded-lg border bg-card px-4 py-3 shadow-xs">
        <h4 className="text-sm font-semibold">{label}</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
      </div>
    );
  }

  return (
    <div>
      {/* The phase's saved indicator is shown once, by the answer box or at
          the foot of the phase card, not on each box. */}
      <h4 className="text-base font-semibold">{label}</h4>
      <label htmlFor={`notes-${phaseId}`} className="sr-only">
        Working notes for this phase
      </label>
      <Textarea
        id={`notes-${phaseId}`}
        className="mt-3 min-h-[140px] resize-y px-3.5 py-3 text-base leading-relaxed"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Working notes for this phase"
      />
      {save.status.kind === "failed" ? (
        <p className="mt-2 text-[13px] text-flag">
          {save.status.message}
        </p>
      ) : null}
    </div>
  );
}
