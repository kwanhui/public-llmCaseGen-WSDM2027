import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseVariants, cases } from "@/lib/db/schema";
import { CaseContentSchema } from "@/lib/generation/schema";
import { generateHint, MAX_HINTS_PER_PHASE } from "@/lib/generation/hint";
import { logCaseEvent } from "@/lib/case/events";
import type { PhaseDefinition } from "@/lib/disciplines/types";

// Student-facing graduated hint: one nudge short of the model answer, for a
// student who is stuck but does not want the full answer revealed. Token-scoped
// (no login), like the other student routes.
//
// The page sends the open phase and the hints it already holds, so each hint is
// more specific than the last. Hints are not stored; the ladder lives in the
// page for as long as it is open.
const RequestSchema = z.object({
  answer: z.string().max(20000).optional(),
  phaseId: z.string().min(1).max(80).optional(),
  previousHints: z.array(z.string().max(2000)).max(MAX_HINTS_PER_PHASE).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const previousHints = parsed.data.previousHints ?? [];
  if (previousHints.length >= MAX_HINTS_PER_PHASE) {
    return NextResponse.json(
      {
        error: "hint_limit",
        message: `You have used all ${MAX_HINTS_PER_PHASE} hints for this phase.`,
      },
      { status: 409 },
    );
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

  const phases = (row.phasesJson as PhaseDefinition[]) ?? [];
  const wanted = parsed.data.phaseId ?? row.currentPhaseId;
  const phaseRow = phases.find((p) => p.id === wanted);
  const phase = phaseRow
    ? {
        id: phaseRow.id,
        label: phaseRow.studentTitle,
        prompt: phaseRow.studentPrompt,
        disciplineHint: phaseRow.disciplineHint,
      }
    : undefined;

  let hint;
  try {
    hint = await generateHint(content.data, parsed.data.answer ?? "", {
      phase,
      previousHints,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "hint_failed", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }

  await logCaseEvent({
    caseId: row.caseId,
    variantId: row.variantId,
    eventType: "hint_requested",
    metadata: { phaseId: phase?.id, step: previousHints.length + 1 },
  });

  return NextResponse.json({
    hint: hint.hint,
    level: hint.level,
    levelName: hint.levelName,
    index: previousHints.length + 1,
    total: MAX_HINTS_PER_PHASE,
  });
}
