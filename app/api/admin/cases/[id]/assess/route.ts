import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases, caseVariants, studentResponses } from "@/lib/db/schema";
import { CaseContentSchema } from "@/lib/generation/schema";
import { assessAttempt } from "@/lib/generation/assess-attempt";
import { logCaseEvent } from "@/lib/case/events";
import { seededCaseGuard } from "@/lib/case/seeded";
import type { PhaseDefinition } from "@/lib/disciplines/types";

const RequestSchema = z.object({ variantId: z.string().min(1) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;
  // An assessment writes an event against the case and makes a model call on
  // the shared demo sign-in, so the seeded cases refuse it like the rest.
  const seeded = seededCaseGuard(id);
  if (seeded) return seeded;

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });

  const [row] = await db
    .select({ id: cases.id, phasesJson: cases.phasesJson })
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [variant] = await db
    .select({ id: caseVariants.id, contentJson: caseVariants.contentJson })
    .from(caseVariants)
    .where(and(eq(caseVariants.id, parsed.data.variantId), eq(caseVariants.caseId, id)));
  if (!variant) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });

  const content = CaseContentSchema.safeParse(variant.contentJson);
  if (!content.success) return NextResponse.json({ error: "invalid_content" }, { status: 422 });

  // Collect the student's answer_attempt submissions for this variant.
  const attempts = await db
    .select({ phaseId: studentResponses.phaseId, contentJson: studentResponses.contentJson })
    .from(studentResponses)
    .where(
      and(
        eq(studentResponses.variantId, variant.id),
        eq(studentResponses.activityType, "answer_attempt"),
      ),
    );
  // Head each answer with the phase it was written for, and send the same
  // phases with the request, so the assessment judges each answer against the
  // task that asked for it rather than against the case as a whole.
  const phaseDefs = (row.phasesJson as PhaseDefinition[]) ?? [];
  const written = attempts
    .map((a) => ({
      phase: phaseDefs.find((p) => p.id === a.phaseId),
      phaseId: a.phaseId,
      text: ((a.contentJson as { text?: string } | null)?.text ?? "").trim(),
    }))
    .filter((a) => a.text !== "")
    .sort((a, b) => (a.phase?.order ?? 0) - (b.phase?.order ?? 0));
  const studentAnswer = written
    .map((a) => `## ${a.phase?.studentTitle ?? a.phaseId}\n${a.text}`)
    .join("\n\n");
  if (!studentAnswer) {
    return NextResponse.json({ error: "no_answer", message: "This team has not saved an answer yet." }, { status: 409 });
  }
  const answeredPhases = written
    .map((a) => a.phase)
    .filter((p): p is PhaseDefinition => p !== undefined)
    .map((p) => ({
      id: p.id,
      label: p.studentTitle,
      prompt: p.studentPrompt,
      hint: p.disciplineHint,
    }));

  let assessment;
  try {
    assessment = await assessAttempt(content.data, studentAnswer, {
      phases: answeredPhases,
      audience: "instructor",
    });
  } catch (err) {
    return NextResponse.json(
      { error: "assessment_failed", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }

  await logCaseEvent({
    caseId: id,
    variantId: variant.id,
    eventType: "attempt_assessed",
    metadata: { band: assessment.band },
  });

  return NextResponse.json({ assessment });
}
