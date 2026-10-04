import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseEvents, caseVariants, cases, studentResponses } from "@/lib/db/schema";
import { logCaseEvent } from "@/lib/case/events";
import type { PhaseDefinition } from "@/lib/disciplines/types";

// How long after a phase advance a write to the phase that just closed is still
// accepted. A student mid-sentence when the instructor advances would otherwise
// lose the sentence: the page flushes it, and this window lets it land. Derived
// from the phase_advanced event already in the log, so there is nothing new to
// store.
const CLOSED_PHASE_GRACE_MS = 10_000;

// True when `phaseId` is the phase the instructor advanced away from less than
// the grace window ago.
async function withinAdvanceGrace(caseId: string, phaseId: string): Promise<boolean> {
  const [last] = await db
    .select({ timestampIso: caseEvents.timestampIso, metadata: caseEvents.metadata })
    .from(caseEvents)
    .where(
      and(eq(caseEvents.caseId, caseId), eq(caseEvents.eventType, "phase_advanced")),
    )
    .orderBy(desc(caseEvents.timestampIso))
    .limit(1);
  if (!last) return false;
  const meta = (last.metadata ?? {}) as { fromPhaseId?: string };
  if (meta.fromPhaseId !== phaseId) return false;
  const advancedAt = Date.parse(last.timestampIso);
  if (Number.isNaN(advancedAt)) return false;
  return Date.now() - advancedAt <= CLOSED_PHASE_GRACE_MS;
}

const ClarifyingContent = z.object({
  items: z.array(z.string().max(2000)).max(20),
});
const NotesContent = z.object({
  text: z.string().max(20000),
});

const RequestSchema = z.object({
  phaseId: z.string().min(1).max(80),
  activityType: z.enum(["clarifying_questions", "notes", "answer_attempt"]),
  // answer_attempt reuses the { text } shape.
  contentJson: z.union([ClarifyingContent, NotesContent]),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [row] = await db
    .select({
      variantId: caseVariants.id,
      caseId: caseVariants.caseId,
      currentPhaseId: cases.currentPhaseId,
      status: cases.status,
      phasesJson: cases.phasesJson,
    })
    .from(caseVariants)
    .innerJoin(cases, eq(caseVariants.caseId, cases.id))
    .where(eq(caseVariants.inviteToken, token));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.status !== "released") {
    return NextResponse.json({ error: "not_released" }, { status: 409 });
  }

  const phases = ((row.phasesJson as PhaseDefinition[]) ?? []).slice().sort(
    (a, b) => a.order - b.order,
  );
  const targetPhase = phases.find((p) => p.id === parsed.data.phaseId);
  const currentPhase = phases.find((p) => p.id === row.currentPhaseId);
  if (!targetPhase || !currentPhase) {
    return NextResponse.json({ error: "phase_not_found" }, { status: 400 });
  }
  // Only the current phase is writable. Past = read-only, future = locked. The
  // one exception is the phase that closed within the last few seconds, so that
  // text typed at the moment of an advance is not lost.
  let lateWrite = false;
  if (targetPhase.order !== currentPhase.order) {
    if (
      targetPhase.order === currentPhase.order - 1 &&
      (await withinAdvanceGrace(row.caseId, targetPhase.id))
    ) {
      lateWrite = true;
    } else {
      return NextResponse.json(
        {
          error: "phase_not_writable",
          message:
            "This phase has closed, so the text was not saved. Copy it before you leave the page.",
        },
        { status: 403 },
      );
    }
  }
  if (!targetPhase.activities.includes(parsed.data.activityType)) {
    return NextResponse.json({ error: "activity_not_in_phase" }, { status: 400 });
  }

  // Upsert (variant_id, phase_id, activity_type).
  const existing = await db
    .select({ id: studentResponses.id })
    .from(studentResponses)
    .where(
      and(
        eq(studentResponses.variantId, row.variantId),
        eq(studentResponses.phaseId, parsed.data.phaseId),
        eq(studentResponses.activityType, parsed.data.activityType),
      ),
    );
  if (existing.length > 0) {
    await db
      .update(studentResponses)
      .set({ contentJson: parsed.data.contentJson, updatedAt: new Date() })
      .where(eq(studentResponses.id, existing[0].id));
  } else {
    await db.insert(studentResponses).values({
      variantId: row.variantId,
      phaseId: parsed.data.phaseId,
      activityType: parsed.data.activityType,
      contentJson: parsed.data.contentJson,
    });
  }

  await logCaseEvent({
    caseId: row.caseId,
    variantId: row.variantId,
    eventType: "response_saved",
    metadata: {
      phaseId: parsed.data.phaseId,
      activityType: parsed.data.activityType,
      ...(lateWrite ? { afterPhaseClosed: true } : {}),
    },
  });

  return NextResponse.json({ ok: true, lateWrite });
}
