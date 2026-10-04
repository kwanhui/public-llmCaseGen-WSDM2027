import { cn } from "@/lib/utils";
import type { PhaseDefinition } from "@/lib/disciplines/types";

// One title form per phase on the student page, "2. Gather and inspect the
// financials": the student-facing title, numbered by its place in the sequence
// when the instructor's title does not carry the number already, with "&"
// written out as "and".
const NUMBER_PREFIX = /^\s*\d+[.)]\s+/;

function displayText(t: string): string {
  return t.replace(/\s*&\s*/g, " and ");
}

export function phaseTitle(phase: PhaseDefinition, index: number): string {
  const t = displayText(phase.studentTitle?.trim() || phase.label);
  return NUMBER_PREFIX.test(t) ? t : `${index + 1}. ${t}`;
}

// The title without its number, for places that draw or say the number
// separately ("Phase 2 of 5: Gather and inspect the financials").
export function phaseTitleText(phase: PhaseDefinition, index: number): string {
  return phaseTitle(phase, index).replace(NUMBER_PREFIX, "");
}

// The stepper doubles as navigation: a phase the student can already see is a
// link down to its card, which is how the task is reached on a phone without
// scrolling past the whole scenario. Phases that are not open yet are plain
// text marked "not yet open", so a tap that does nothing is explained. Below sm it is
// one phase per line at 13 px, each row 44 px tall. From sm up the phases wrap into rows, each with
// a short connector in the padding on its left. The list is pulled left by that
// padding inside a clipping box, so the connector of a phase that starts a row
// falls outside the box and is not drawn: connectors only join phases on the
// same row.
export function PhaseStepper({
  phases,
  currentPhaseId,
}: {
  phases: PhaseDefinition[];
  currentPhaseId: string | null;
}) {
  const sorted = [...phases].sort((a, b) => a.order - b.order);
  const currentIdx = sorted.findIndex((p) => p.id === currentPhaseId);
  // The phase with the answer box is where hints and feedback open; the line
  // below the list names it rather than saying "the answer phase".
  const answerIdx = sorted.findIndex((p) => p.activities.includes("answer_attempt"));
  return (
    <div className="space-y-1">
      <div className="sm:overflow-hidden sm:py-1 sm:pl-1">
        <ol className="text-[13px] leading-relaxed sm:-ml-8 sm:flex sm:flex-wrap sm:items-center">
          {sorted.map((p, i) => {
            const done = currentIdx >= 0 && i < currentIdx;
            const active = currentIdx >= 0 && i === currentIdx;
            const reachable = done || active;
            // A numbered disc in the student accent, as in the landing page's
            // diagram: filled for the open phase, tinted for a finished one and
            // outlined for one not yet open. The disc is drawn for the eye; the
            // text a screen reader hears is the phase title, "2. Title".
            const inner = (
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
                    active
                      ? "bg-student text-student-foreground"
                      : done
                        ? "bg-student/10 text-student"
                        : "border border-input/80 bg-card text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>{" "}
                <span
                  className={cn(
                    active ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground",
                    done && "underline decoration-student/40 underline-offset-2",
                  )}
                >
                  <span className="sr-only">{i + 1}. </span>
                  {phaseTitleText(p, i)}
                </span>
              </span>
            );
            return (
              <li key={p.id} className="relative flex items-center sm:pl-8">
                <span
                  aria-hidden="true"
                  className="absolute left-2 top-1/2 hidden h-px w-5 bg-border sm:block"
                />
                {reachable ? (
                  <a
                    href={`#phase-${p.id}`}
                    aria-current={active ? "step" : undefined}
                    className="flex min-h-[44px] items-center rounded-md px-1 hover:text-foreground"
                  >
                    {inner}
                  </a>
                ) : (
                  <span className="flex min-h-[44px] items-center gap-1.5 px-1">
                    {inner}
                    <span className="text-muted-foreground/80">not yet open</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {/* Said here only until the team reaches that phase; from there the
          line beside the hint and feedback buttons says it. */}
      {answerIdx >= 0 && currentIdx < answerIdx ? (
        <p className="px-1 text-[13px] text-muted-foreground">
          Hints and feedback open in phase {answerIdx + 1} and are not graded.
        </p>
      ) : null}
    </div>
  );
}
