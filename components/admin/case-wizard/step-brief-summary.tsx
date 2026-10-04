import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { CARD } from "@/components/admin/styles";
import type { Difficulty } from "@/lib/disciplines/types";
import { cn } from "@/lib/utils";

// Step 1 of a saved case: the brief as it was saved, read-only. The form is for
// new cases only; before approval the brief is changed from the Retrieval step.
export function StepBriefSummary({
  caseId,
  disciplineLabel,
  brief,
  briefLocked,
  primaryNext = true,
}: {
  caseId: string;
  disciplineLabel: string;
  brief: {
    learningObjective: string;
    difficulty: Difficulty;
    mustCoverConcepts: string[];
    targetLearnerProfile: { industry: string; role: string; priorKnowledge: string };
  };
  briefLocked: boolean;
  // False on an example case, where Duplicate is the primary button.
  primaryNext?: boolean;
}) {
  const p = brief.targetLearnerProfile;
  return (
    <div className="space-y-4">
      <section className={cn(CARD, "px-4 py-4 sm:px-5 sm:py-5")}>
        <h3 className="text-base font-semibold">The brief</h3>
        <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label="Learning objective" wide>
            {brief.learningObjective}
          </Field>
          <Field label="Discipline">{disciplineLabel}</Field>
          <Field label="Difficulty">
            <span className="capitalize">{brief.difficulty}</span>
          </Field>
          <Field label="Must-cover concepts" wide>
            {brief.mustCoverConcepts.length > 0 ? brief.mustCoverConcepts.join(", ") : "None set"}
          </Field>
          <Field label="Industry or practice context">{p.industry}</Field>
          <Field label="Role">{p.role}</Field>
          <Field label="Prior knowledge">{p.priorKnowledge}</Field>
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">
          {briefLocked
            ? "The brief is locked with the case."
            : "To change the brief, use Edit the brief and regenerate on the Retrieval step."}
        </p>
      </section>
      <div className="flex justify-end border-t pt-4">
        <Link href={`/admin/cases/${caseId}?step=2`} className={buttonClass(primaryNext ? "primary" : "outline", "md")}>
          Continue to retrieval
        </Link>
      </div>
    </div>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
