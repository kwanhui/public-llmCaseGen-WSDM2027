import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { logCaseEvent } from "@/lib/case/events";

// Clone a case into a fresh editable draft, so an instructor can reuse or
// version a case rather than authoring each from scratch. The copy keeps the
// input, the generated content, and the (possibly customised) phase sequence,
// but resets status, telemetry, and any release/variant state.
//
// Duplicating is the way out of a seeded example case, which is read-only, so
// this route has no seeded-case guard.

// Name the copy without burying a leading tag. An objective that opens with a
// bracketed marker, such as "[REVIEW] Value a regional bank...", keeps the
// marker in front, because lists and filters are read on that first token.
function copyName(objective: string): string {
  const tag = objective.match(/^(\[[^\]]{1,32}\]\s*)/);
  return tag ? `${tag[1]}Copy of ${objective.slice(tag[1].length)}` : `Copy of ${objective}`;
}
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;

  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date();
  const [created] = await db
    .insert(cases)
    .values({
      instructorId,
      discipline: row.discipline,
      learningObjective: copyName(row.learningObjective),
      difficulty: row.difficulty,
      mustCoverConcepts: row.mustCoverConcepts,
      targetLearnerProfile: row.targetLearnerProfile,
      contentJson: row.contentJson,
      phasesJson: row.phasesJson,
      currentPhaseId: null,
      status: row.contentJson ? "editing" : "draft",
      authoringStartedAt: now,
      authoringApprovedAt: null,
      authoringSecondsLogged: null,
      regenerationCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: cases.id });

  await logCaseEvent({ caseId: created.id, eventType: "created", metadata: { duplicatedFrom: id } });

  return NextResponse.json({ id: created.id });
}
