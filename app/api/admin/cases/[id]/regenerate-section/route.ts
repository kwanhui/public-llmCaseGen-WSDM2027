import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { regenerateSection } from "@/lib/generation/regenerate-section";
import { checkConceptCoverage } from "@/lib/generation/generate-case";
import {
  CaseContentSchema,
  CASE_SECTIONS,
  type CaseContent,
} from "@/lib/generation/schema";
import {
  attemptSeconds,
  describeAttempts,
  runGenerationAttempts,
  type Validation,
} from "@/lib/generation/generate-attempts";
import { logCaseEvent } from "@/lib/case/events";
import { seededCaseGuard } from "@/lib/case/seeded";
import type { CaseInput } from "@/lib/disciplines/types";

const RequestSchema = z.object({
  section: z.enum(CASE_SECTIONS as [string, ...string[]]),
  editorNote: z.string().max(2000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;
  const seeded = seededCaseGuard(id);
  if (seeded) return seeded;

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!row.contentJson) {
    return NextResponse.json(
      { error: "no_content_yet", message: "Generate the case first." },
      { status: 409 },
    );
  }

  const currentParsed = CaseContentSchema.safeParse(row.contentJson);
  if (!currentParsed.success) {
    return NextResponse.json({ error: "invalid_existing_content" }, { status: 500 });
  }

  const input: CaseInput = {
    discipline: row.discipline as CaseInput["discipline"],
    learningObjective: row.learningObjective,
    difficulty: row.difficulty as CaseInput["difficulty"],
    mustCoverConcepts: (row.mustCoverConcepts as string[]) ?? [],
    targetLearnerProfile: row.targetLearnerProfile as CaseInput["targetLearnerProfile"],
  };

  // Concepts the lexical check cannot find in the current draft are named in
  // the prompt, so that regenerating the scenario or the questions after a
  // missing-concept line has something to act on.
  const missingConcepts = checkConceptCoverage(
    currentParsed.data,
    input.mustCoverConcepts,
  ).missing;

  // Two attempts, and the merged case has to satisfy the editor and student
  // schema before anything is written. A section that comes back malformed (for
  // example all five questions returned as one string) would otherwise be saved
  // and leave the editor with nothing it can open.
  //
  // The schema does not tie the two arrays together, so a regeneration of the
  // questions or the answers is also checked for one answer per question. A
  // draft that lost that pairing would reach the team links and the student
  // page, and nothing later checks the count before approval. The retry says
  // the count outright; if it comes back wrong again, nothing is written and
  // the section keeps its old text.
  //
  // The attempts run under the time limits of the Generate case route
  // (lib/generation/generate-attempts.ts), so a stalled model call ends in a
  // reply rather than in the platform's HTTP 504.
  const section = parsed.data.section as Parameters<typeof regenerateSection>[0]["section"];
  const pairedSection = section === "discussionQuestions" || section === "modelAnswers";
  let countMismatch = false;

  const run = await runGenerationAttempts(
    (abortSignal) =>
      regenerateSection({
        input,
        currentContent: currentParsed.data,
        section,
        editorNote: parsed.data.editorNote,
        missingConcepts,
        answerCountRetry: countMismatch,
        options: { abortSignal },
      }),
    (result): Validation<{ merged: CaseContent; provenance: string[] }> => {
      const candidate = CaseContentSchema.safeParse({
        ...currentParsed.data,
        ...result.patch,
      });
      if (!candidate.success) {
        return {
          ok: false,
          failure: {
            reason: "schema_validation",
            detail: candidate.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          },
        };
      }
      if (
        pairedSection &&
        candidate.data.discussionQuestions.length !== candidate.data.modelAnswers.length
      ) {
        countMismatch = true;
        return {
          ok: false,
          failure: {
            reason: "answer_count_mismatch",
            detail: [
              `${candidate.data.discussionQuestions.length} discussion questions, ` +
                `${candidate.data.modelAnswers.length} model answers`,
            ],
          },
        };
      }
      return { ok: true, value: { merged: candidate.data, provenance: result.provenance } };
    },
  );
  console.info(`[regenerate-section] case ${id} ${section}: ${describeAttempts(run.attempts)}`);

  if (!run.value) {
    const lastFailure = run.lastFailure;
    await logCaseEvent({
      caseId: id,
      eventType: "generation_failed",
      metadata: {
        stage: "section_regeneration",
        section: parsed.data.section,
        reason: lastFailure?.reason ?? "unknown",
        detail: lastFailure?.detail ?? [],
        attempts: run.attempts.length,
        attemptSeconds: attemptSeconds(run.attempts),
      },
    });
    const tried =
      run.attempts.length > 1
        ? "on the first attempt or on the automatic retry"
        : "and there was no time left for the automatic retry";
    return NextResponse.json(
      {
        error: "generation_failed",
        message:
          lastFailure?.reason === "answer_count_mismatch"
            ? `The model returned ${lastFailure.detail[0]}, ${run.attempts.length > 1 ? "on the first attempt and on the automatic retry" : "and there was no time left for the automatic retry"}. Every question needs its own answer, so nothing was saved and this section is unchanged.`
            : run.timedOut
              ? `The model did not answer in time, ${tried}. Nothing was saved and this section is unchanged. Try again in a moment.`
              : `The model did not return a usable section, ${tried}. Nothing was saved and this section is unchanged.`,
      },
      { status: 502 },
    );
  }
  const { merged, provenance } = run.value;

  await db
    .update(cases)
    .set({
      contentJson: merged,
      status: row.status === "draft" ? "editing" : row.status,
      regenerationCount: sql`${cases.regenerationCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, id));

  await logCaseEvent({
    caseId: id,
    eventType: "section_regenerated",
    metadata: {
      section: parsed.data.section,
      editorNote: parsed.data.editorNote ?? null,
      missingConceptsPassed: missingConcepts,
      retrieval: provenance,
    },
  });

  return NextResponse.json({ contentJson: merged });
}
