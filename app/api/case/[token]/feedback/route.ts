import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseVariants, cases } from "@/lib/db/schema";
import { CaseContentSchema } from "@/lib/generation/schema";
import { assessAttempt } from "@/lib/generation/assess-attempt";
import { retrySchemaFailureOnce } from "@/lib/generation/schema-retry";
import { logCaseEvent } from "@/lib/case/events";
import type { PhaseDefinition } from "@/lib/disciplines/types";

// Student-facing formative feedback: the learner asks for rubric-grounded
// feedback on their own answer. Same assessment the instructor can run, exposed
// to the student so the feedback loop does not depend on the instructor. Token-
// scoped (no login), like the other student routes.
//
// The open phase is sent with the request so that the feedback addresses the
// task that phase sets rather than the whole case.
const RequestSchema = z.object({
  answer: z.string().min(1).max(20000),
  phaseId: z.string().min(1).max(80).optional(),
});

// Below this length there is not enough to judge against a rubric, so no rating
// is returned. Chosen to sit just under a short paragraph.
const MIN_WORDS = 40;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const [row] = await db
    .select({
      variantId: caseVariants.id,
      caseId: caseVariants.caseId,
      contentJson: caseVariants.contentJson,
      status: cases.status,
      phasesJson: cases.phasesJson,
      currentPhaseId: cases.currentPhaseId,
    })
    .from(caseVariants)
    .innerJoin(cases, eq(caseVariants.caseId, cases.id))
    .where(eq(caseVariants.inviteToken, token));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.status !== "released") {
    return NextResponse.json({ error: "not_released" }, { status: 409 });
  }

  const content = CaseContentSchema.safeParse(row.contentJson);
  if (!content.success) return NextResponse.json({ error: "invalid_content" }, { status: 422 });

  const words = wordCount(parsed.data.answer);
  if (words < MIN_WORDS) {
    await logCaseEvent({
      caseId: row.caseId,
      variantId: row.variantId,
      eventType: "feedback_requested",
      metadata: { notRated: "too_short", words },
    });
    return NextResponse.json({
      notRated: {
        reason: `Your answer is ${words} word${words === 1 ? "" : "s"} long, which is too short to judge against the rubric. Write at least ${MIN_WORDS} words and ask again.`,
      },
    });
  }

  // Send the open phase so the feedback answers what that phase asks for. Fall
  // back to the case's current phase if the page did not send one.
  const phases = ((row.phasesJson as PhaseDefinition[]) ?? []);
  const wanted = parsed.data.phaseId ?? row.currentPhaseId;
  const phaseRow = phases.find((p) => p.id === wanted);
  const phase = phaseRow
    ? {
        id: phaseRow.id,
        label: phaseRow.studentTitle,
        prompt: phaseRow.studentPrompt,
        hint: phaseRow.disciplineHint,
      }
    : undefined;

  let assessment;
  try {
    // A schema failure is retried once; the second one returns the 502 below.
    assessment = await retrySchemaFailureOnce("case/feedback", () =>
      assessAttempt(content.data, parsed.data.answer, {
        phase,
        audience: "student",
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: "feedback_failed", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }

  if (!assessment.rated) {
    await logCaseEvent({
      caseId: row.caseId,
      variantId: row.variantId,
      eventType: "feedback_requested",
      metadata: { notRated: "off_topic", phaseId: phase?.id },
    });
    return NextResponse.json({
      notRated: {
        reason:
          assessment.reasonNotRated.trim() ||
          "Your answer does not engage with anything in this case, so there is nothing to rate against the rubric.",
      },
    });
  }

  await logCaseEvent({
    caseId: row.caseId,
    variantId: row.variantId,
    eventType: "feedback_requested",
    metadata: { band: assessment.band, phaseId: phase?.id },
  });

  return NextResponse.json({ assessment });
}
