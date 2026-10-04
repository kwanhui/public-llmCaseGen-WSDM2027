"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CaseMarkdown } from "./case-render";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { PhaseStepper, phaseTitle as numberedTitle, phaseTitleText } from "./phase-stepper";
import { PhaseSaveIndicator, FinishedLine } from "./save-indicator";
import { ActivityClarifyingQuestions } from "./activity-clarifying-questions";
import { ActivityNotes } from "./activity-notes";
import { ActivityAnswerAttempt } from "./activity-answer-attempt";
import { ReadingControls, useReadingPrefs, SCALE_REM } from "./reading-controls";
import { flushPendingSaves, onSaveRefused, type UnsavedWork } from "./use-autosave";
import { getSessionText, getSessionList, getPhaseHelp } from "./session-work";
import { isReflectionPhase } from "@/lib/case/phase-kind";
import { hintLevel } from "@/lib/generation/hint-levels";
import { buttonClass } from "@/components/ui/button";
import { instructorWord } from "./instructor-wording";
import { cn } from "@/lib/utils";

// The card surface and the tonal banners of the student page, in the student
// lane's indigo accent.
const CARD = "rounded-lg border bg-card text-card-foreground shadow-xs";
const BANNER_STUDENT = "rounded-lg border border-student/25 bg-student/[0.06] px-4 py-3";
const BANNER_FLAG = "rounded-lg border border-flag/30 bg-flag/5 px-4 py-3";
// Scenario and prompts are set at a reading measure of 680 px.
const MEASURE = "max-w-[680px]";
import type { PhaseDefinition } from "@/lib/disciplines/types";

interface ResponseMap {
  [phaseId: string]: {
    clarifying_questions?: { items: string[] };
    notes?: { text: string };
    answer_attempt?: { text: string };
  };
}

interface Props {
  token: string;
  disciplineLabel: string;
  teamName: string | null;
  // The team's role from its learner profile, shown in the team pill.
  teamRole: string | null;
  caseRef: string;
  learningObjective: string;
  learningOutcomes: string[];
  scenario: string;
  phases: PhaseDefinition[];
  initialCurrentPhaseId: string | null;
  status: "draft" | "generating" | "editing" | "approved" | "released" | string;
  initialResponses: ResponseMap;
  glossary: { term: string; definition: string }[];
  finalContent: { discussionQuestions: string[]; modelAnswers: string[]; rubric: string };
  // The rating this team last gave, read back from the event log so it is still
  // there after a reload.
  initialRating: number | null;
  // A seeded example variant: its invite link is public, so every visitor
  // shares the same page. The page says so and leaves out the team rating.
  isSeededExample: boolean;
}

export function CaseViewerClient({
  token,
  disciplineLabel,
  teamName,
  teamRole,
  caseRef,
  learningObjective,
  learningOutcomes,
  scenario,
  phases,
  initialCurrentPhaseId,
  status,
  initialResponses,
  glossary,
  finalContent,
  initialRating,
  isSeededExample,
}: Props) {
  const router = useRouter();
  const [currentPhaseId, setCurrentPhaseId] = useState<string | null>(initialCurrentPhaseId);
  // The scenario starts open in every phase: the task cannot be done without
  // it. Held in state so that re-renders from polling do not reopen or close
  // it under the student.
  const [scenarioOpen, setScenarioOpen] = useState(true);
  const [released, setReleased] = useState(status === "released");
  const [toast, setToast] = useState<string | null>(null);
  const [reading, setReading] = useReadingPrefs();
  const [rated, setRated] = useState<number | null>(initialRating);
  const [hovered, setHovered] = useState(0);
  const [unsaved, setUnsaved] = useState<UnsavedWork[]>([]);
  const reportedView = useRef(false);
  const yourInstructor = instructorWord(isSeededExample);
  const YourInstructor = instructorWord(isSeededExample, true);

  // A box whose phase has just closed is replaced by its read-only version, so
  // text the server would not take is repeated here where it can still be
  // copied.
  useEffect(() => onSaveRefused((work) => setUnsaved((prev) => [...prev, work])), []);

  // The rating is stored as an event, so it survives a reload and reaches the
  // analytics export. A failed post is reported, since the student would
  // otherwise think that the rating had been recorded.
  const [ratingFailed, setRatingFailed] = useState(false);
  async function rateCase(rating: number) {
    const previous = rated;
    setRated(rating);
    setRatingFailed(false);
    try {
      const res = await fetch(`/api/case/${token}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setRated(previous);
      setRatingFailed(true);
    }
  }

  // Log a view once the case is open. A visit before release is recorded
  // separately by the server, so the view is reported again on release.
  useEffect(() => {
    if (reportedView.current && released) return;
    reportedView.current = true;
    fetch(`/api/case/${token}/view`, { method: "POST" }).catch(() => {});
  }, [token, released]);

  const [checking, setChecking] = useState(false);

  // Check once for phase advancement. Shared by the interval, the manual
  // refresh button, and the tab-became-visible handler.
  const checkState = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/case/${token}/state`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { currentPhaseId: string | null; status: string };
      const nowReleased = data.status === "released";
      if (data.currentPhaseId !== currentPhaseId) {
        // Push whatever is still sitting in the boxes before the phase closes,
        // so a sentence typed at the moment of the advance is not lost.
        await flushPendingSaves();
        const firstOpen = currentPhaseId === null;
        setCurrentPhaseId(data.currentPhaseId);
        setReleased(nowReleased);
        const ordered = [...phases].sort((a, b) => a.order - b.order);
        const advancedIdx = ordered.findIndex((p) => p.id === data.currentPhaseId);
        const advancedTo = advancedIdx >= 0 ? ordered[advancedIdx] : null;
        if (firstOpen) {
          setToast(`${YourInstructor} has released this case.`);
          setTimeout(() => setToast(null), 4500);
        } else if (advancedTo) {
          setToast(`Phase ${advancedIdx + 1} is now open: ${phaseTitleText(advancedTo, advancedIdx)}`);
          setTimeout(() => setToast(null), 4500);
        }
        router.refresh();
      } else if (nowReleased !== released) {
        setReleased(nowReleased);
        router.refresh();
      }
    } catch {
      // ignore polling errors
    } finally {
      setChecking(false);
    }
  }, [token, currentPhaseId, released, phases, router, YourInstructor]);

  // Poll only while the tab is visible, and stop entirely when it is hidden, so
  // a backgrounded tab on a metered or low-bandwidth connection uses no data.
  // The interval is 15 seconds; the "Check whether the next phase is open"
  // button covers urgency.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(checkState, 15000);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        checkState();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkState]);

  // The download reflects what is on the screen: the text currently in the
  // boxes, plus the hints and feedback the page is holding. Hints and feedback
  // are kept only in this browser, so this file is the copy to keep.
  function downloadMyWork() {
    const lines: string[] = [];
    lines.push(`# ${disciplineLabel} case: my work`);
    lines.push("");
    if (teamLabel) lines.push(`Team: ${teamLabel}`);
    lines.push(`Exported from PersCase on ${formatDateTime(new Date())} (Singapore time).`);
    lines.push("");
    lines.push(`## Scenario`);
    lines.push(scenario);
    lines.push("");
    for (const phase of sortedPhases) {
      const stored = initialResponses[phase.id] ?? {};
      const questions =
        getSessionList(phase.id, "clarifying_questions") ??
        stored.clarifying_questions?.items ??
        [];
      const notes = getSessionText(phase.id, "notes") ?? stored.notes?.text ?? "";
      const answer =
        getSessionText(phase.id, "answer_attempt") ?? stored.answer_attempt?.text ?? "";
      const help = getPhaseHelp(token, phase.id);
      const hints = help.hints;
      const feedback = help.feedback;
      const hasAny =
        questions.some((x) => x.trim()) ||
        notes.trim() !== "" ||
        answer.trim() !== "" ||
        hints.length > 0 ||
        feedback !== null;
      if (!hasAny) continue;
      lines.push(`## ${numberedTitle(phase, sortedPhases.indexOf(phase))}`);
      if (questions.some((x) => x.trim())) {
        lines.push(`**Clarifying questions**`);
        for (const q of questions.filter((x) => x.trim())) lines.push(`- ${q}`);
      }
      if (notes.trim()) {
        lines.push(`**Notes**`);
        lines.push(notes.trim());
      }
      if (answer.trim()) {
        lines.push(`**My answer**`);
        lines.push(answer.trim());
      }
      if (hints.length > 0) {
        lines.push(
          `**Hints I asked for** (AI-generated, not reviewed by ${isSeededExample ? yourInstructor : "my instructor"})`,
        );
        hints.forEach((h, i) => lines.push(`${i + 1}. (${hintLevel(i + 1).name}) ${h}`));
      }
      if (feedback) {
        lines.push(
          isReflectionPhase(phase)
            ? `**Feedback on my answer** (AI-generated, not a grade)`
            : `**Feedback on my answer** (AI-generated, not a grade): ${feedback.band}`,
        );
        if (feedback.safetyNote?.trim()) lines.push(feedback.safetyNote.trim());
        if (feedback.disclosureNote?.trim()) lines.push(feedback.disclosureNote.trim());
        for (const c of feedback.criteria) {
          lines.push(`- ${c.criterion}: ${c.judgment}${c.nextStep ? ` Next: ${c.nextStep}` : ""}`);
        }
        if (feedback.overall) lines.push(`Overall: ${feedback.overall}`);
        if (feedback.nextStep) lines.push(`Next step: ${feedback.nextStep}`);
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `perscase-my-work-${disciplineLabel.toLowerCase().replace(/\s+/g, "-")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const sortedPhases = [...phases].sort((a, b) => a.order - b.order);
  const currentIdx = sortedPhases.findIndex((p) => p.id === currentPhaseId);
  const visiblePhases =
    currentIdx >= 0 ? sortedPhases.slice(0, currentIdx + 1) : [];
  const isReleased = released;
  const onLastPhase =
    currentIdx >= 0 && currentIdx === sortedPhases.length - 1;
  const currentPhase = currentIdx >= 0 ? sortedPhases[currentIdx] : null;
  // "Team Alpha, junior analyst": the team and the role its variant is
  // written for.
  const teamLabel = teamName ? (teamRole ? `${teamName}, ${teamRole}` : teamName) : null;

  // The only privacy and storage text on the page. The notes and answer boxes
  // carry none of their own.
  const privacyNotice = (
    <div className="space-y-2">
      {isSeededExample ? (
        <p role="note" className={cn(BANNER_STUDENT, "text-sm font-medium")}>
          Other visitors do not see what you type, but the instructor who set this example
          can, and reloading the page clears it; use Download my work to keep a copy.
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {/* On a seeded example the banner above already says who can read the
            typing. */}
        {isSeededExample
          ? null
          : `${YourInstructor} and your team can read what you type here; your team shares one copy of each box. `}
        Text you send for a hint or for feedback goes to an external AI service; your notes
        are not sent to one. Do not include names or other details of real clients, colleagues
        or organisations.
      </p>
    </div>
  );

  const titleOf = (phaseId: string) => {
    const i = sortedPhases.findIndex((p) => p.id === phaseId);
    return i >= 0 ? numberedTitle(sortedPhases[i], i) : phaseId;
  };

  return (
    <div className="space-y-6">
      {unsaved.length > 0 ? (
        <section className={cn(BANNER_FLAG, "text-sm")}>
          <h2 className="font-medium text-flag">Some text was not saved</h2>
          {unsaved.map((w, i) => (
            <div key={i} className="mt-3">
              <p className="text-[13px] text-muted-foreground">
                {titleOf(w.phaseId)} · {w.message}
              </p>
              <textarea
                readOnly
                value={w.text}
                aria-label={`Unsaved text from ${titleOf(w.phaseId)}`}
                className="mt-1 min-h-[120px] w-full rounded-md border border-input/70 bg-card p-3 text-sm shadow-xs"
              />
            </div>
          ))}
        </section>
      ) : null}

      {toast ? (
        // In the flow of the page, so that it never covers the case text.
        <div role="status" className={cn(BANNER_STUDENT, "text-sm font-medium text-student")}>
          {toast}
        </div>
      ) : null}

      {!isReleased ? (
        <div className="space-y-4">
          <div className={cn(BANNER_STUDENT, "px-5 py-5 text-sm")}>
            <strong>Not yet released.</strong>{" "}
            <span>This page will show the case when {yourInstructor} releases it.</span>
            <div className="mt-3">
              <button
                type="button"
                onClick={checkState}
                disabled={checking}
                className={buttonClass("outline", "md", "min-h-[44px] text-[13px]")}
              >
                {checking ? "Checking…" : "Check if it is open yet"}
              </button>
            </div>
          </div>
          {privacyNotice}
        </div>
      ) : (
        <div
          style={{ fontSize: SCALE_REM[reading.scale] }}
          className={reading.comfort ? "space-y-8 leading-loose tracking-wide" : "space-y-8"}
        >
          {/* First screen: the status line, the objective, "Go to task" and
              the scenario, open. Everything else follows it. */}
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-semibold">{disciplineLabel} case</h1>
            {teamLabel ? (
              <p className="inline-flex items-center rounded-full bg-student/10 px-3 py-1 text-sm font-medium text-student">
                {teamLabel}
              </p>
            ) : null}
          </header>

          <section className={cn(CARD, "px-4 py-4 sm:px-6")}>
            {currentPhase ? (
              <h2 className="text-sm font-semibold text-student">
                <span>
                  Phase {currentIdx + 1} of {sortedPhases.length}
                </span>
                : {phaseTitleText(currentPhase, currentIdx)}
              </h2>
            ) : null}
            <div className={cn(MEASURE, "mt-2")}>
              <p className="text-base">{learningObjective}</p>
              {learningOutcomes.length > 0 ? (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Concepts in this case: {learningOutcomes.join(", ")}
                </p>
              ) : null}
            </div>
            {currentPhase ? (
              <a
                href={`#phase-${currentPhase.id}`}
                className={buttonClass("primary", "md", "mt-4 min-h-[44px]")}
              >
                Go to task
              </a>
            ) : null}
          </section>

          <details
            open={scenarioOpen}
            onToggle={(e) => setScenarioOpen(e.currentTarget.open)}
            className="border-t pt-4"
          >
            <summary className="min-h-[44px] w-fit cursor-pointer rounded-sm py-2 text-xl font-semibold">
              {scenarioOpen ? "Scenario" : "Show the scenario"}
            </summary>
            <div className={cn(MEASURE, "mt-2")}>
              <CaseMarkdown className="text-[1.0625em] leading-[1.7]">{scenario}</CaseMarkdown>
            </div>
          </details>

          <div className="grid gap-4 sm:grid-cols-2">
            {glossary.length > 0 ? (
              <details className={cn(CARD, "px-4")}>
                <summary className="min-h-[44px] cursor-pointer rounded-sm py-3 text-sm font-semibold">
                  Key terms ({glossary.length})
                </summary>
                <dl className="space-y-2 pb-3 text-sm">
                  {glossary.map((g, i) => (
                    <div key={i}>
                      <dt className="font-medium">{g.term}</dt>
                      <dd className="text-muted-foreground">{g.definition}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
            {finalContent.rubric.trim() ? (
              <details className={cn(CARD, "px-4")}>
                <summary className="min-h-[44px] cursor-pointer rounded-sm py-3 text-sm font-semibold">
                  Rubric
                </summary>
                <div>
                  <CaseMarkdown className="[&_p]:whitespace-pre-line">
                    {finalContent.rubric}
                  </CaseMarkdown>
                </div>
                <p className="mt-2 pb-3 text-[13px] text-muted-foreground">
                  Feedback on your answer is written against this rubric.
                </p>
              </details>
            ) : null}
          </div>

          <div className="space-y-3 border-t pt-4">
            <PhaseStepper phases={sortedPhases} currentPhaseId={currentPhaseId} />
            <ReadingControls prefs={reading} onChange={setReading} />
          </div>

          {privacyNotice}

          {visiblePhases.map((phase) => {
            const isCurrent = phase.id === currentPhaseId;
            const stored = initialResponses[phase.id] ?? {};
            return (
              <section
                key={phase.id}
                id={`phase-${phase.id}`}
                className={cn(
                  "scroll-mt-20 rounded-lg border px-4 py-5 sm:px-6",
                  isCurrent
                    ? "border-student/40 bg-card shadow-xs ring-1 ring-inset ring-student/10"
                    : "bg-muted/30",
                )}
              >
                <div>
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-xl font-semibold">
                        {numberedTitle(phase, sortedPhases.indexOf(phase))}
                      </h3>
                      {phase.suggestedMinutes ? (
                        <span className="text-[13px] text-muted-foreground" title="Suggested working time. The page does not advance by itself.">
                          ~{phase.suggestedMinutes} min
                        </span>
                      ) : null}
                    </div>
                    {isCurrent ? (
                      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-student/10 px-2.5 py-0.5 text-[13px] font-medium text-student">
                        Current phase
                      </span>
                    ) : (
                      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-muted px-2.5 py-0.5 text-[13px] text-muted-foreground">
                        Closed
                      </span>
                    )}
                  </header>
                  <div className={cn(MEASURE, "mt-3")}>
                    <CaseMarkdown className="text-[1em]">{phase.studentPrompt}</CaseMarkdown>
                  </div>
                  {phase.disciplineHint ? (
                    <div className={cn(MEASURE, "mt-3")}>
                      <CaseMarkdown className="text-[13px] text-muted-foreground [&_p]:my-0 [&_strong]:text-foreground">
                        {`**Tip:** ${phase.disciplineHint}`}
                      </CaseMarkdown>
                    </div>
                  ) : null}

                  <div className="mt-6 space-y-4">
                    {phase.activities.includes("clarifying_questions") ? (
                      <ActivityClarifyingQuestions
                        token={token}
                        phaseId={phase.id}
                        initial={stored.clarifying_questions?.items ?? []}
                        readOnly={!isCurrent}
                      />
                    ) : null}
                    {phase.activities.includes("answer_attempt") ? (
                      <ActivityAnswerAttempt
                        token={token}
                        phaseId={phase.id}
                        initial={stored.answer_attempt?.text ?? ""}
                        readOnly={!isCurrent}
                        discussionQuestions={finalContent.discussionQuestions}
                        modelAnswers={finalContent.modelAnswers}
                        canRevealModelAnswers={onLastPhase && isCurrent}
                        isReflection={isReflectionPhase(phase)}
                        isSeededExample={isSeededExample}
                        rubric={finalContent.rubric}
                      />
                    ) : null}
                    {/* At the answer phase the notes sit below the answer box
                        and say that they are not the answer. */}
                    {phase.activities.includes("notes") ? (
                      <ActivityNotes
                        token={token}
                        phaseId={phase.id}
                        initial={stored.notes?.text ?? ""}
                        readOnly={!isCurrent}
                        label={
                          phase.activities.includes("answer_attempt")
                            ? "Notes for yourself (not sent for feedback)"
                            : "Notes"
                        }
                      />
                    ) : null}
                    {/* Without an answer box, the phase's one saved indicator
                        sits under its boxes. */}
                    {isCurrent && !phase.activities.includes("answer_attempt") ? (
                      <PhaseSaveIndicator phaseId={phase.id} className="block" />
                    ) : null}
                  </div>
                  {isCurrent && !onLastPhase ? (
                    <div className="mt-6 space-y-2 border-t pt-4">
                      <p className="text-[13px] text-muted-foreground">
                        {YourInstructor} opens each phase when the class is ready. This page
                        checks every 15 seconds; the button checks now.
                      </p>
                      <button
                        type="button"
                        onClick={checkState}
                        disabled={checking}
                        className={buttonClass("outline", "md", "min-h-[44px] text-[13px]")}
                      >
                        {checking ? "Checking…" : "Check whether the next phase is open"}
                      </button>
                    </div>
                  ) : null}
                  {isCurrent && onLastPhase ? (
                    <div className="mt-6">
                      <FinishedLine
                        token={token}
                        phaseId={phase.id}
                        hasAnswerBox={phase.activities.includes("answer_attempt")}
                        instructor={YourInstructor}
                      />
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}

          {/* The answer box lists the discussion questions itself, so this
              section is for a final phase that has no answer box. */}
          {onLastPhase && !currentPhase?.activities.includes("answer_attempt") ? (
            <section className={cn(CARD, "px-4 py-5 sm:px-6")}>
              <h3 className="text-xl font-semibold">Discussion questions</h3>
              <ol className={cn(MEASURE, "mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed")}>
                {finalContent.discussionQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </section>
          ) : null}

          <footer className="space-y-2 border-t pt-6 text-[13px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={downloadMyWork}
                className={buttonClass("outline", "md", "min-h-[44px] text-[13px]")}
              >
                Download my work
              </button>
              {/* The rating belongs to the team, not to this browser, so the
                  line says so, and the stars stay open for another rating. A
                  shared example has no team, so it has no rating either. */}
              {isSeededExample ? null : (
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">
                    {rated !== null
                      ? `Your team rated this case ${rated} out of 5. Rate it again:`
                      : "Rate this case:"}
                  </span>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => rateCase(n)}
                      onMouseEnter={() => setHovered(n)}
                      onMouseLeave={() => setHovered(0)}
                      onFocus={() => setHovered(n)}
                      onBlur={() => setHovered(0)}
                      aria-label={`Rate ${n} out of 5`}
                      className="min-h-[44px] min-w-[44px] rounded-md text-lg leading-none text-muted-foreground transition-colors hover:text-student"
                    >
                      {(hovered > 0 ? hovered : (rated ?? 0)) >= n ? "★" : "☆"}
                    </button>
                  ))}
                </span>
              )}
            </div>
            {ratingFailed ? (
              <p className="text-flag">Your rating was not recorded. Please try again.</p>
            ) : null}
            <p>The download holds your notes, answers, hints and feedback.</p>
            <details>
              <summary className="min-h-[44px] w-fit cursor-pointer rounded-sm py-3 font-medium text-muted-foreground hover:text-foreground">
                About this case and how to cite it
              </summary>
              <p className="mt-2">
                {isSeededExample
                  ? "This case was drafted by an AI language model with reference notes written by the tool's authors, and it is an example case approved by the instructor who set it."
                  : "This case was drafted by an AI language model with reference notes written by the tool's authors, and it was reviewed and approved by your instructor before release."}{" "}
                If you refer to it in your own work, you can cite it as:
              </p>
              <p className="mt-1 font-mono text-[13px] text-foreground">
                PersCase {disciplineLabel} case <span className="break-all">{caseRef}</span>{" "}
                {isSeededExample
                  ? "(AI-generated, approved by the instructor who set it),"
                  : "(AI-generated, instructor-approved),"}{" "}
                accessed {formatDate(new Date())}.
              </p>
              <p className="mt-2">
                Visits to this page are counted with a one-way hash of your device; no name is
                collected.
              </p>
            </details>
          </footer>
        </div>
      )}
    </div>
  );
}
