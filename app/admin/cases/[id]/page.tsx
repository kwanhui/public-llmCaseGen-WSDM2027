import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { eq, and, asc, desc } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases, caseEvents, caseVariants } from "@/lib/db/schema";
import { CoInstructorNote } from "@/components/admin/co-instructor-note";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { WizardProgress } from "@/components/admin/case-wizard/wizard-progress";
import { StepRetrievalPreview } from "@/components/admin/case-wizard/step-retrieval-preview";
import { StepGeneration } from "@/components/admin/case-wizard/step-generation";
import { StepEditor } from "@/components/admin/case-wizard/step-editor";
import { PhaseEditor } from "@/components/admin/phase-editor";
import { AdvancePhaseBanner } from "@/components/admin/advance-phase-banner";
import { DuplicateCaseButton } from "@/components/admin/duplicate-case-button";
import { DeleteCaseButton } from "@/components/admin/case-actions";
import { TeamLinks } from "@/components/admin/team-links";
import { StepBriefSummary } from "@/components/admin/case-wizard/step-brief-summary";
import { EXAMPLE_CASE_NOTICE, StatusPill } from "@/components/admin/status-pill";
import { caseRemovalSummary } from "@/lib/case/removal";
import {
  CaseContentSchema,
  type CaseContent,
} from "@/lib/generation/schema";
import { checkConceptCoverage, difficultySignal } from "@/lib/generation/generate-case";
import {
  RETRIEVAL_MIN_SCORE,
  RETRIEVAL_WEAK_SCORE,
  retrievePreview,
} from "@/lib/retrieval/embedding-provider";
import { corpusForDiscipline } from "@/lib/retrieval/corpus";
import { groundingUtilisation } from "@/lib/retrieval/grounding";
import { loadTeamProvenance } from "@/lib/generation/compare-store";
import { isReadOnlyCase } from "@/lib/case/seeded";
import { DISCIPLINE_PACKS } from "@/lib/disciplines";
import { CARD, LINK, NOTE_MUTED } from "@/components/admin/styles";
import { cn } from "@/lib/utils";
import { disciplineName } from "@/lib/text/display";
import type {
  CaseInput,
  DisciplineId,
  Difficulty,
  PhaseDefinition,
} from "@/lib/disciplines/types";

const VALID_STEPS = ["1", "2", "3", "4"] as const;
type Step = (typeof VALID_STEPS)[number];

export const metadata = { title: "Case editor · PersCase" };

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;
  const { step: stepParam } = await searchParams;

  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!row) notFound();

  // Latest co-instructor handoff note (most recent instructor_note event).
  const [latestNote] = await db
    .select({ metadata: caseEvents.metadata, timestampIso: caseEvents.timestampIso })
    .from(caseEvents)
    .where(and(eq(caseEvents.caseId, id), eq(caseEvents.eventType, "instructor_note")))
    .orderBy(desc(caseEvents.timestampIso))
    .limit(1);
  const noteMeta = (latestNote?.metadata as { note?: string; author?: string } | null) ?? null;

  const pack = DISCIPLINE_PACKS[row.discipline as DisciplineId];
  const hasContent = row.contentJson !== null;
  const contentParse = row.contentJson ? CaseContentSchema.safeParse(row.contentJson) : null;
  const validContent: CaseContent | null =
    contentParse && contentParse.success ? contentParse.data : null;

  // Default step: 4 (editor) when content exists; otherwise 2 (retrieval preview).
  const defaultStep: Step = validContent ? "4" : "2";
  const step: Step = (VALID_STEPS as readonly string[]).includes(stepParam ?? "")
    ? (stepParam as Step)
    : defaultStep;

  const phases = (row.phasesJson as PhaseDefinition[]) ?? [];
  const isReleased = row.status === "released";
  const isApproved = row.status === "approved" || isReleased;
  // Seeded showcase cases and the walkthrough cases are read-only on the shared
  // demo sign-in; the API refuses the mutating routes for them, so the controls are taken away here
  // rather than left to fail.
  const seeded = isReadOnlyCase(id);
  const locked = isApproved || seeded;

  // Live retrieval preview for step 2 (one embedding call). A failed call
  // comes back as a status, not an exception, so the page still renders.
  const caseInput: CaseInput = {
    discipline: row.discipline as DisciplineId,
    learningObjective: row.learningObjective,
    difficulty: row.difficulty as Difficulty,
    mustCoverConcepts: (row.mustCoverConcepts as string[]) ?? [],
    targetLearnerProfile: row.targetLearnerProfile as CaseInput["targetLearnerProfile"],
  };
  const retrieval =
    step === "2"
      ? await retrievePreview(caseInput)
      : {
          chunks: [],
          embedded: false,
          status: "ok" as const,
          error: null,
          queryText: "",
          minScore: RETRIEVAL_MIN_SCORE,
          weakScore: RETRIEVAL_WEAK_SCORE,
          budget: 5,
          firstRejected: null,
          firstOverBudget: null,
          leftOut: [],
          lowestTakenScore: null,
        };

  // Per-note grounding for the draft the case holds, read against the passages
  // recorded with its last completed generation. Shown on the retrieval tab.
  const draftProvenance =
    step === "2" && validContent ? await loadTeamProvenance(id) : null;
  const draftGrounding = draftProvenance
    ? groundingUtilisation(validContent!, draftProvenance, caseInput)
    : null;

  // Team links, listed on the case page under the team variants summary.
  const variantRows = isApproved
    ? await db
        .select({
          id: caseVariants.id,
          token: caseVariants.inviteToken,
          learnerProfileJson: caseVariants.learnerProfileJson,
        })
        .from(caseVariants)
        .where(eq(caseVariants.caseId, id))
        .orderBy(asc(caseVariants.createdAt))
    : [];
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const teamLinks = variantRows
    .map((v) => {
      const lp = v.learnerProfileJson as { displayName?: string | null; industry: string; role: string };
      return { id: v.id, name: lp.displayName ?? `${lp.role} · ${lp.industry}`, url: `${origin}/case/${v.token}` };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  // What Delete takes with it, for its confirmation. Example cases cannot be
  // deleted, so they skip the count.
  const removal = seeded ? null : await caseRemovalSummary(id).catch(() => null);

  const coInstructorNote = (
    <CoInstructorNote
      caseId={id}
      initialNote={noteMeta?.note ?? ""}
      author={noteMeta?.author ?? null}
      updatedAt={latestNote?.timestampIso ?? null}
      readOnly={seeded}
    />
  );

  const sortedPhases = [...phases].sort((a, b) => a.order - b.order);
  const phaseIndex = sortedPhases.findIndex((p) => p.id === row.currentPhaseId);

  return (
    <section>
      <PageHeader
        title={disciplineName(pack.label) + " case"}
        description={row.learningObjective}
        back={{ href: "/admin/cases", label: "Back to cases" }}
        action={
          // Outline buttons: the step's own next action is the one primary
          // button on the screen. On an example case that action is Duplicate.
          <div className="flex items-center gap-2">
            <DuplicateCaseButton caseId={id} primary={seeded} />
            {hasContent ? (
              <Link href={`/admin/cases/${id}/compare`} className={buttonClass("outline", "sm")}>
                Contrastive view
              </Link>
            ) : null}
            {isApproved && step !== "4" ? (
              <Link href={`/admin/cases/${id}/variants`} className={buttonClass("outline", "sm")}>
                Team variants
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <WizardProgress
          current={Number(step) as 1 | 2 | 3 | 4}
          caseId={id}
          hasDraft={validContent !== null}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <StatusPill
            status={row.status}
            phase={phaseIndex >= 0 ? { index: phaseIndex + 1, total: sortedPhases.length } : null}
          />
          {row.regenerationCount > 0 ? (
            <span className="tabular-nums">Regenerations: {row.regenerationCount}</span>
          ) : null}
          {row.authoringSecondsLogged != null ? (
            <span className="tabular-nums">
              Authoring time: {Math.round(row.authoringSecondsLogged / 60)} min
            </span>
          ) : null}
        </div>
      </div>

      {seeded ? <p className={cn(NOTE_MUTED, "mt-4")}>{EXAMPLE_CASE_NOTICE}</p> : null}

      {/* On step 2 the note box sits under the summary line and "Continue to
          generation", so the next action is above the fold. */}
      {step !== "2" ? <div className="mt-4">{coInstructorNote}</div> : null}

      <div className="mt-8 space-y-6">
        {step === "1" && (
          <StepBriefSummary
            caseId={id}
            disciplineLabel={disciplineName(pack.label)}
            brief={{
              learningObjective: caseInput.learningObjective,
              difficulty: caseInput.difficulty,
              mustCoverConcepts: caseInput.mustCoverConcepts,
              targetLearnerProfile: caseInput.targetLearnerProfile,
            }}
            briefLocked={locked}
            primaryNext={!seeded}
          />
        )}
        {step === "2" && (
          <StepRetrievalPreview
            caseId={id}
            discipline={row.discipline as DisciplineId}
            difficulty={row.difficulty as Difficulty}
            retrieval={retrieval}
            corpusSize={corpusForDiscipline(row.discipline as DisciplineId).length}
            brief={{
              learningObjective: caseInput.learningObjective,
              difficulty: caseInput.difficulty,
              mustCoverConcepts: caseInput.mustCoverConcepts,
              targetLearnerProfile: caseInput.targetLearnerProfile,
            }}
            briefLocked={locked}
            draftGrounding={draftGrounding}
            primaryNext={!seeded}
            approved={isApproved}
            afterSummary={coInstructorNote}
          />
        )}
        {step === "3" && (
          <StepGeneration
            caseId={id}
            hasExistingContent={hasContent}
            readOnly={seeded}
            approved={isApproved}
          />
        )}
        {step === "4" && validContent && (
          <>
            <AdvancePhaseBanner
              caseId={id}
              status={row.status}
              phases={phases}
              currentPhaseId={row.currentPhaseId}
              teamLinkCount={teamLinks.length}
              readOnly={seeded}
            />
            {isApproved ? (
              <TeamLinks
                caseId={id}
                links={teamLinks}
                primary={!seeded && row.status === "approved" && teamLinks.length === 0}
              />
            ) : null}
            <StepEditor
              caseId={id}
              initialContent={validContent}
              status={row.status}
              conceptCoverage={checkConceptCoverage(
                validContent,
                (row.mustCoverConcepts as string[]) ?? [],
              )}
              difficulty={difficultySignal(
                validContent,
                row.difficulty as "novice" | "intermediate" | "advanced",
              )}
              quantitative={pack.quantitative ?? false}
              approvalReminder={pack.approvalReminder}
              regenerateNoteExample={pack.regenerateNoteExample}
              readOnly={seeded}
            />
            <PhaseEditor
              caseId={id}
              initialPhases={phases}
              defaultPhases={pack.defaultPhases}
              disabled={seeded}
              status={row.status}
              currentPhaseId={row.currentPhaseId}
            />
          </>
        )}
        {step === "4" && !validContent && (
          <div className={cn(CARD, "p-6 text-sm")}>
            No valid content yet. Go to{" "}
            <Link href={`/admin/cases/${id}?step=3`} className={LINK}>
              Generation
            </Link>{" "}
            to draft the case.
          </div>
        )}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-sm">
        <a
          href={`/api/admin/cases/${id}/provenance`}
          className={LINK}
          title="The brief, the approval and the event trail"
        >
          Download provenance (JSON)
        </a>
        {removal ? (
          <DeleteCaseButton
            id={id}
            teamLinks={removal.variants}
            savedAnswers={removal.responses}
          />
        ) : null}
      </div>
    </section>
  );
}
