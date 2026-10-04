import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { logCaseEvent } from "@/lib/case/events";
import { seededCaseGuard } from "@/lib/case/seeded";
import type { PhaseDefinition } from "@/lib/disciplines/types";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;
  const seeded = seededCaseGuard(id);
  if (seeded) return seeded;

  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.status !== "released") {
    return NextResponse.json(
      { error: "not_released", message: "Release the case before advancing phases." },
      { status: 409 },
    );
  }

  const phases = ((row.phasesJson as PhaseDefinition[]) ?? []).slice().sort(
    (a, b) => a.order - b.order,
  );
  const currentIdx = phases.findIndex((p) => p.id === row.currentPhaseId);
  if (currentIdx < 0) {
    return NextResponse.json({ error: "current_phase_missing" }, { status: 500 });
  }
  if (currentIdx >= phases.length - 1) {
    return NextResponse.json(
      { error: "already_last_phase", currentPhaseId: row.currentPhaseId },
      { status: 409 },
    );
  }

  const next = phases[currentIdx + 1];
  await db
    .update(cases)
    .set({ currentPhaseId: next.id, updatedAt: new Date() })
    .where(eq(cases.id, id));

  await logCaseEvent({
    caseId: id,
    eventType: "phase_advanced",
    metadata: {
      fromPhaseId: row.currentPhaseId,
      toPhaseId: next.id,
      newIndex: currentIdx + 1,
      total: phases.length,
    },
  });

  return NextResponse.json({
    ok: true,
    currentPhaseId: next.id,
    currentIndex: currentIdx + 1,
    total: phases.length,
  });
}
