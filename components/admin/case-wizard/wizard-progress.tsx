import Link from "next/link";
import { cn } from "@/lib/utils";

// The four stages of the case workflow; the landing page's diagram uses the
// same names.
const STEPS = [
  { n: 1, label: "Input" },
  { n: 2, label: "Retrieval" },
  { n: 3, label: "Generation" },
  { n: 4, label: "Edit and approve" },
];

interface Props {
  current: 1 | 2 | 3 | 4;
  // With a case id the stages are links, so the stepper is also the way to move
  // between them. Stage 1 shows the saved brief, read-only, and stage 4 needs a
  // draft.
  caseId?: string;
  hasDraft?: boolean;
}

// Numbered discs joined by hairlines, as in the landing page's diagram. The
// text content of each stage stays "1 Input", "2 Retrieval" and so on.
export function WizardProgress({ current, caseId, hasDraft = false }: Props) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {STEPS.map((s, i) => {
        const active = current === s.n;
        const done = s.n < current;
        const linked = caseId && (s.n < 4 || hasDraft) && !active;
        const disc = (
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : done
                  ? "bg-primary/10 text-primary"
                  : "border border-input/80 bg-card text-muted-foreground",
            )}
          >
            {s.n}
          </span>
        );
        return (
          <li key={s.n} className="flex items-center gap-x-2">
            {linked ? (
              <Link
                href={`/admin/cases/${caseId}?step=${s.n}`}
                className="group inline-flex items-center gap-2 rounded-full py-0.5 pr-2 font-medium text-foreground hover:text-primary"
              >
                {disc} <span className="underline-offset-2 group-hover:underline">{s.label}</span>
              </Link>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-2 py-0.5 pr-2",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
                aria-current={active ? "step" : undefined}
              >
                {disc} <span>{s.label}</span>
              </span>
            )}
            {i < STEPS.length - 1 ? (
              <span className="h-px w-6 bg-border sm:w-10" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
