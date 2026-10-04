import { notFound } from "next/navigation";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseEvents, caseVariants, cases, studentResponses } from "@/lib/db/schema";
import { CaseContentSchema } from "@/lib/generation/schema";
import { CaseViewerClient } from "@/components/case-viewer/case-viewer-client";
import { DISCIPLINE_PACKS } from "@/lib/disciplines";
import type { DisciplineId, PhaseDefinition } from "@/lib/disciplines/types";
import { isSeededCase } from "@/lib/case/seeded";
import { SiteHeader } from "@/components/site-header";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface ResponseRow {
  phaseId: string;
  activityType: string;
  contentJson: unknown;
}

// A link pasted into a chat message often picks up the sentence's full stop or
// a closing bracket. Strip trailing punctuation before the lookup so the link
// still resolves.
function cleanToken(raw: string): string {
  return raw.replace(/[.,;:!?)\]}>'"«»]+$/, "");
}

// The tab a student has open among their other coursework tabs. It names the
// discipline and nothing else: the product name and what the tool is for
// belong on the instructor's side of the application.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token: rawToken } = await params;
  const [row] = await db
    .select({ discipline: cases.discipline })
    .from(caseVariants)
    .innerJoin(cases, eq(caseVariants.caseId, cases.id))
    .where(eq(caseVariants.inviteToken, cleanToken(rawToken)));
  if (!row) return { title: "Case" };
  const pack = DISCIPLINE_PACKS[row.discipline as DisciplineId];
  return { title: `${pack?.label ?? "Case study"} case` };
}

export default async function StudentCasePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const token = cleanToken(rawToken);

  const [row] = await db
    .select({
      variantId: caseVariants.id,
      variantContent: caseVariants.contentJson,
      learnerProfileJson: caseVariants.learnerProfileJson,
      caseId: cases.id,
      discipline: cases.discipline,
      learningObjective: cases.learningObjective,
      mustCoverConcepts: cases.mustCoverConcepts,
      phasesJson: cases.phasesJson,
      currentPhaseId: cases.currentPhaseId,
      status: cases.status,
    })
    .from(caseVariants)
    .innerJoin(cases, eq(caseVariants.caseId, cases.id))
    .where(eq(caseVariants.inviteToken, token));

  if (!row) notFound();

  const seeded = isSeededCase(row.caseId);
  const contentParse = CaseContentSchema.safeParse(row.variantContent);
  if (!contentParse.success) {
    return (
      <>
      <SiteHeader variant="student" exampleCase={seeded} />
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-12">
        <div className="rounded-lg border border-flag/30 bg-flag/5 px-4 py-3 text-sm text-flag">
          This link is no longer active. Check with your instructor.
        </div>
      </main>
      </>
    );
  }

  // A seeded example's link is public, so the rows under it are other
  // visitors' typing. The page starts empty for each visitor; what they type is
  // still autosaved and kept in their own session for the download.
  const responseRows: ResponseRow[] = seeded
    ? []
    : await db
        .select({
          phaseId: studentResponses.phaseId,
          activityType: studentResponses.activityType,
          contentJson: studentResponses.contentJson,
        })
        .from(studentResponses)
        .where(eq(studentResponses.variantId, row.variantId));

  const responseMap: Record<
    string,
    {
      clarifying_questions?: { items: string[] };
      notes?: { text: string };
      answer_attempt?: { text: string };
    }
  > = {};
  for (const r of responseRows) {
    if (!responseMap[r.phaseId]) responseMap[r.phaseId] = {};
    if (r.activityType === "clarifying_questions") {
      const c = r.contentJson as { items?: string[] } | null;
      responseMap[r.phaseId].clarifying_questions = { items: c?.items ?? [] };
    } else if (r.activityType === "notes") {
      const c = r.contentJson as { text?: string } | null;
      responseMap[r.phaseId].notes = { text: c?.text ?? "" };
    } else if (r.activityType === "answer_attempt") {
      const c = r.contentJson as { text?: string } | null;
      responseMap[r.phaseId].answer_attempt = { text: c?.text ?? "" };
    }
  }

  const pack = DISCIPLINE_PACKS[row.discipline as DisciplineId];
  const learnerProfile = row.learnerProfileJson as {
    displayName?: string | null;
    role?: string | null;
  } | null;

  // The team's own rating, kept in the event log rather than on the variant
  // row. The most recent one wins, so a team that rates again sees the new
  // figure.
  const [lastRating] = await db
    .select({ metadata: caseEvents.metadata })
    .from(caseEvents)
    .where(
      and(
        eq(caseEvents.variantId, row.variantId),
        eq(caseEvents.eventType, "quality_rated"),
      ),
    )
    .orderBy(desc(caseEvents.timestampIso))
    .limit(1);
  const ratingValue = (lastRating?.metadata as { rating?: number } | null)?.rating;
  const initialRating =
    typeof ratingValue === "number" && ratingValue >= 1 && ratingValue <= 5
      ? ratingValue
      : null;

  return (
    <>
    <SiteHeader variant="student" exampleCase={seeded} />
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <CaseViewerClient
          token={token}
          disciplineLabel={pack.label}
          teamName={learnerProfile?.displayName?.trim() || null}
          teamRole={learnerProfile?.role?.trim() || null}
          caseRef={row.caseId}
          isSeededExample={seeded}
          learningObjective={row.learningObjective}
          learningOutcomes={(row.mustCoverConcepts as string[]) ?? []}
          scenario={contentParse.data.scenario}
          phases={(row.phasesJson as PhaseDefinition[]) ?? []}
          initialCurrentPhaseId={row.currentPhaseId}
          status={row.status}
          initialResponses={responseMap}
          initialRating={initialRating}
          glossary={contentParse.data.glossary ?? []}
          finalContent={{
            discussionQuestions: contentParse.data.discussionQuestions,
            modelAnswers: contentParse.data.modelAnswers,
            rubric: contentParse.data.rubric,
          }}
        />
      </div>
    </main>
    </>
  );
}
