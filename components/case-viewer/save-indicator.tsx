"use client";

import { usePhaseSaveSummary } from "./use-autosave";
import { usePhaseHelp } from "./session-work";
import { cn } from "@/lib/utils";

// The phase's one saved indicator ("Saved 10:42", "Saving…"), summing up every
// box in the phase. Empty until the student types.
export function PhaseSaveIndicator({ phaseId, className }: { phaseId: string; className?: string }) {
  const s = usePhaseSaveSummary(phaseId);
  return (
    <span
      aria-live="polite"
      className={cn(
        "text-[13px]",
        s.kind === "failed" || s.kind === "retrying"
          ? "text-flag"
          : s.kind === "saved"
            ? "text-student"
            : "text-muted-foreground",
        className,
      )}
    >
      {s.label}
    </span>
  );
}

// The feedback route rates nothing shorter than this (MIN_WORDS in
// app/api/case/[token]/feedback/route.ts), so the feedback button waits for it,
// and an answer this long counts as finished.
export const MIN_FEEDBACK_WORDS = 40;

// Shown in the last phase once feedback has been given in the phase, or the
// saved answer has at least MIN_FEEDBACK_WORDS words (in a last phase with no
// answer box, once any of its boxes has been saved), so the team knows nothing
// else is owed. A one-word autosave does not count.
export function FinishedLine({
  token,
  phaseId,
  hasAnswerBox,
  instructor,
}: {
  token: string;
  phaseId: string;
  hasAnswerBox: boolean;
  // "Your instructor", or the seeded example's wording.
  instructor: string;
}) {
  const s = usePhaseSaveSummary(phaseId);
  const help = usePhaseHelp(token, phaseId);
  const done = hasAnswerBox
    ? help.feedback !== null || (s.answerSaved && s.answerWords >= MIN_FEEDBACK_WORDS)
    : s.anySaved;
  if (!done) return null;
  return (
    <p role="status" className="text-sm font-medium text-student">
      You have finished this case. {instructor} can read your answers.
    </p>
  );
}
