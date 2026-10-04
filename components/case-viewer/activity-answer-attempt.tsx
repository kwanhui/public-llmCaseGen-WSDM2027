"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/input";
import { CaseMarkdown } from "./case-render";
import { useAutosave } from "./use-autosave";
import {
  criteriaRated,
  feedbackChecks,
  getPhaseHelp,
  setPhaseHelp,
  setSessionText,
  usePhaseHelp,
  type SessionFeedback,
} from "./session-work";
import { PhaseSaveIndicator, MIN_FEEDBACK_WORDS } from "./save-indicator";
import { instructorWord } from "./instructor-wording";
import { HINT_LADDER_NOTE, hintHeading } from "@/lib/generation/hint-levels";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Hint and feedback cards sit on the card surface, a step inside the phase.
const HELP_CARD = "rounded-lg border bg-card px-4 py-3 text-[13px] shadow-xs";

const MAX_HINTS = 3;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// The reason a button is disabled, as visible text under it: a tooltip does
// not show on a touch screen.
function DisabledReason({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="max-w-[18rem] text-[13px] text-muted-foreground">
      {children}
    </p>
  );
}

// The number of criteria the rubric names: one per "(NN%)" weight, or else one
// per non-empty line. The feedback view uses it to say when the assessment
// covered fewer criteria than the rubric has.
function countRubricCriteria(rubric: string): number {
  const weights = rubric.match(/\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)/g);
  if (weights && weights.length > 0) return weights.length;
  return rubric.split(/\r?\n/).filter((l) => l.trim() !== "").length;
}

interface Props {
  token: string;
  phaseId: string;
  initial: string;
  readOnly: boolean;
  // The case's discussion questions and model answers. The questions sit in a
  // closed disclosure above the box, for reference beside the phase task; the model answers
  // are revealed for self-check only in the final phase, since they cover the
  // whole case and would give away phases that are not open yet.
  discussionQuestions: string[];
  modelAnswers: string[];
  canRevealModelAnswers: boolean;
  // A reflection asks the student for their own account of the case, so the
  // feedback on it carries no level badge.
  isReflection: boolean;
  // A seeded example: the page names "the instructor who set this example".
  isSeededExample: boolean;
  // The case's rubric text, to count its criteria.
  rubric: string;
}

// The band is a tonal pill in the student accent, the same for every band, so
// that its colour does not read as a score on top of its word.
const BAND_PILL =
  "inline-flex items-center rounded-full bg-student/10 px-2.5 py-0.5 text-[13px] font-medium text-student";

export function ActivityAnswerAttempt({
  token,
  phaseId,
  initial,
  readOnly,
  discussionQuestions,
  modelAnswers,
  canRevealModelAnswers,
  isReflection,
  isSeededExample,
  rubric,
}: Props) {
  const yourInstructor = instructorWord(isSeededExample);
  const YourInstructor = instructorWord(isSeededExample, true);
  const rubricCriteria = countRubricCriteria(rubric);
  const [text, setText] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  // Hints, feedback and whether an answer was sent live in the page's store,
  // which keeps them in this browser across a reload.
  const help = usePhaseHelp(token, phaseId);
  const { hints, feedback } = help;
  const [notRated, setNotRated] = useState<string | null>(null);
  const [feedbackState, setFeedbackState] = useState<"idle" | "loading" | "error">("idle");
  const [disputed, setDisputed] = useState(false);
  // Checks above the band, and "m criteria, k not addressed" from the criteria
  // the answer addressed against the rubric's count (older feedback carries
  // neither field).
  const feedbackView = feedback
    ? {
        ...feedbackChecks(feedback),
        rated: criteriaRated(feedback),
        total: feedback.criteriaTotal ?? Math.max(rubricCriteria, feedback.criteria.length),
      }
    : null;
  const [hintState, setHintState] = useState<"idle" | "loading" | "error">("idle");
  const box = useRef<HTMLTextAreaElement | null>(null);

  const save = useAutosave({
    token,
    phaseId,
    activityType: "answer_attempt",
    enabled: !readOnly,
    hasStoredText: initial.trim() !== "",
    storedWords: wordCount(initial),
  });

  // Keep the page's own copy of the work in step with the box, so the download
  // matches the screen.
  useEffect(() => {
    setSessionText(phaseId, "answer_attempt", text);
  }, [phaseId, text]);

  // Grow the box with the answer rather than making the student scroll six
  // lines of a hundred-word answer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(140, el.scrollHeight)}px`;
  }, [text]);

  async function getHint() {
    if (hints.length >= MAX_HINTS) return;
    setHintState("loading");
    try {
      const res = await fetch(`/api/case/${token}/hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: text, phaseId, previousHints: hints }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      const now = getPhaseHelp(token, phaseId);
      setPhaseHelp(token, phaseId, { ...now, hints: [...now.hints, data.hint as string] });
      setHintState("idle");
    } catch {
      setHintState("error");
    }
  }

  async function getFeedback() {
    if (wordCount(text) < MIN_FEEDBACK_WORDS || feedback) return;
    setFeedbackState("loading");
    try {
      const res = await fetch(`/api/case/${token}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: text, phaseId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      const now = getPhaseHelp(token, phaseId);
      // An answer that could not be rated does not use up the feedback.
      if (data.notRated) {
        setPhaseHelp(token, phaseId, { ...now, sent: true });
        setNotRated(data.notRated.reason as string);
      } else {
        setNotRated(null);
        setPhaseHelp(token, phaseId, {
          ...now,
          sent: true,
          feedback: data.assessment as SessionFeedback,
        });
      }
      setDisputed(false);
      setFeedbackState("idle");
    } catch {
      setFeedbackState("error");
    }
  }

  async function flagFeedback() {
    setDisputed(true);
    try {
      await fetch(`/api/case/${token}/feedback-flag`, { method: "POST" });
    } catch {
      // best-effort; the student already sees acknowledgement
    }
  }

  function onChange(next: string) {
    setText(next);
    save.schedule({ text: next });
  }

  // The phase prompt above is the one task at this phase. The discussion
  // questions are what the model answers cover, so they sit in a closed
  // disclosure with a line that says which task the box is for.
  const Questions =
    discussionQuestions.length > 0 ? (
      <div>
        <details className="rounded-lg border bg-card px-4 shadow-xs">
          <summary className="min-h-[44px] cursor-pointer rounded-sm py-3 text-sm font-semibold">
            Discussion questions ({discussionQuestions.length})
          </summary>
          <ol className="list-decimal space-y-1.5 pb-3 pl-5 text-sm leading-relaxed">
            {discussionQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </details>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Your answer is to the task above; the model answers cover these questions.
        </p>
      </div>
    ) : null;

  const words = wordCount(text);
  const feedbackReason = feedback
    ? "You have had the feedback on this answer"
    : words < MIN_FEEDBACK_WORDS
      ? `Write at least ${MIN_FEEDBACK_WORDS} words to ask for feedback`
      : null;
  const revealReason = help.sent
    ? null
    : "Model answers unlock after you ask for feedback in this phase";

  // A closed phase shows the answer written in it, and no empty box when
  // there is none.
  if (readOnly) {
    if (text.trim() === "") return null;
    return (
      <div className="rounded-lg border bg-card px-4 py-3 shadow-xs">
        <h4 className="text-sm font-semibold">
          Your answer
        </h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {Questions}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-base font-semibold">Your answer</h4>
          <PhaseSaveIndicator phaseId={phaseId} />
        </div>
        <label htmlFor={`answer-${phaseId}`} className="sr-only">
          Your answer to the task for this phase
        </label>
        <Textarea
          id={`answer-${phaseId}`}
          ref={box}
          className="mt-2 min-h-[140px] resize-y overflow-hidden px-3.5 py-3 text-base leading-relaxed"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write your answer here"
        />
        {save.status.kind === "failed" ? (
          <p className="mt-2 text-[13px] text-flag">
            {save.status.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={getHint}
            disabled={hintState === "loading" || hints.length >= MAX_HINTS}
            className={buttonClass("outline", "md", "min-h-[44px] text-[13px]")}
          >
            {hintState === "loading"
              ? "Getting a hint…"
              : hints.length === 0
                ? "Get a hint"
                : hints.length >= MAX_HINTS
                  ? "All 3 hints used"
                  : hintHeading(hints.length + 1, MAX_HINTS, "Get hint")}
          </button>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={getFeedback}
              disabled={feedbackState === "loading" || feedbackReason !== null}
              aria-describedby={feedbackReason ? `feedback-reason-${phaseId}` : undefined}
              className={buttonClass("primary", "md", "min-h-[44px] self-start text-[13px]")}
            >
              {feedbackState === "loading" ? "Getting feedback…" : "Get feedback on my answer"}
            </button>
            {feedbackReason ? (
              <DisabledReason id={`feedback-reason-${phaseId}`}>{feedbackReason}</DisabledReason>
            ) : null}
          </div>
          {canRevealModelAnswers && !revealed ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setRevealed(true)}
                disabled={revealReason !== null}
                aria-describedby={revealReason ? `reveal-reason-${phaseId}` : undefined}
                className={buttonClass(
                  "outline",
                  "md",
                  "min-h-[44px] self-start text-[13px] disabled:cursor-not-allowed",
                )}
              >
                Reveal the model answers
              </button>
              {revealReason ? (
                <DisabledReason id={`reveal-reason-${phaseId}`}>{revealReason}</DisabledReason>
              ) : null}
            </div>
          ) : null}
          <p className="self-center text-[13px] text-muted-foreground">
            {MAX_HINTS} hints and 1 feedback per answer
          </p>
        </div>
        {!canRevealModelAnswers ? (
          <p className="text-[13px] text-muted-foreground">
            Model answers cover the whole case, so they open in the final phase.
          </p>
        ) : null}
        {hintState === "error" ? (
          <p className="text-[13px] text-flag">Could not get a hint. Please try again.</p>
        ) : null}
        {hints.length > 0 ? (
          <div role="status" aria-live="polite" className={cn(HELP_CARD, "space-y-2")}>
            <p className="text-[13px] text-muted-foreground">
              AI-generated hints, not reviewed by {yourInstructor}.
            </p>
            <p className="text-[13px] text-muted-foreground">{HINT_LADDER_NOTE}</p>
            {hints.map((h, i) => (
              <div key={i} className="border-t pt-2 text-[13px]">
                <p className="font-semibold text-student">{hintHeading(i + 1, MAX_HINTS)}</p>
                <CaseMarkdown className="text-[13px] [&_p]:my-1">{h}</CaseMarkdown>
              </div>
            ))}
          </div>
        ) : null}
        {feedbackState === "error" ? (
          <p className="text-[13px] text-flag">Could not generate feedback. Please try again.</p>
        ) : null}
        {notRated ? (
          <div role="status" aria-live="polite" className={HELP_CARD}>
            <p className="font-semibold">No rating for this answer</p>
            <p className="mt-1 text-muted-foreground">{notRated}</p>
          </div>
        ) : null}
        {feedback ? (
          <div role="status" aria-live="polite" className={HELP_CARD}>
            {feedbackView && feedbackView.flags.length > 0 ? (
              <div className="mb-3 rounded-md border border-flag/30 bg-flag/5 px-3 py-2">
                <p className="font-semibold">Checks</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-flag">
                  {feedbackView.flags.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Formative feedback</span>
              {isReflection ? null : (
                <span className={BAND_PILL}>
                  {feedback.band.charAt(0).toUpperCase() + feedback.band.slice(1)}
                </span>
              )}
            </div>
            {isReflection ? null : (
              <p className="mt-1 text-[13px] text-muted-foreground">
                Bands: needs work, developing, proficient, strong; against the rubric&apos;s criteria.
              </p>
            )}
            {feedbackView?.safetyNote ? (
              <p className="mt-2 text-flag">
                {feedbackView.safetyNote}
              </p>
            ) : null}
            {feedback.disclosureNote?.trim() ? (
              <p className="mt-2">
                {feedback.disclosureNote}
              </p>
            ) : null}
            {feedbackView && feedbackView.rated < feedbackView.total ? (
              <p className="mt-2 text-muted-foreground">
                {feedbackView.total} criteria, {feedbackView.total - feedbackView.rated} not addressed
              </p>
            ) : null}
            <ul className="mt-3 divide-y border-y">
              {feedback.criteria.map((c, i) => (
                <li key={i} className="py-2">
                  <span className="font-medium">{c.criterion}:</span>{" "}
                  <span className="text-muted-foreground">{c.judgment}</span>
                  {c.nextStep ? (
                    <div className="mt-0.5 text-foreground">Next: {c.nextStep}</div>
                  ) : null}
                </li>
              ))}
            </ul>
            {feedback.overall ? (
              <p className="mt-2">
                <span className="font-medium">Overall:</span>{" "}
                <span className="text-muted-foreground">{feedback.overall}</span>
              </p>
            ) : null}
            {feedback.nextStep ? (
              <p className="mt-3 rounded-md border-l-2 border-student bg-student/[0.06] px-3 py-2">
                <span className="font-semibold text-student">Next step:</span> {feedback.nextStep}
              </p>
            ) : null}
            <p className="mt-2 text-[13px] text-muted-foreground">
              AI-generated formative feedback against the rubric, to guide revision. Not a grade.
            </p>
            <div className="mt-2">
              {disputed ? (
                <p className="text-[13px] text-muted-foreground">
                  {YourInstructor} will see that this feedback was flagged.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={flagFeedback}
                  className="inline-flex min-h-[44px] items-center rounded-sm text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {isSeededExample
                    ? "Flag this feedback for the instructor who set this example"
                    : "Flag this feedback for my instructor"}
                </button>
              )}
            </div>
          </div>
        ) : null}
        {revealed ? (
          <div className={cn(HELP_CARD, "text-sm")}>
            <h5 className="text-sm font-semibold">Model answers to the discussion questions</h5>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Each model answer follows the discussion question it answers.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Figures in these model answers have not been checked by the system;{" "}
              {yourInstructor} may have corrected them.
            </p>
            <ol className="mt-2 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
              {discussionQuestions.map((q, i) => (
                <li key={i}>
                  <span className="font-medium">{q}</span>
                  {modelAnswers[i] ? (
                    <div className="mt-1 text-muted-foreground">
                      <CaseMarkdown>{modelAnswers[i]}</CaseMarkdown>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  );
}
