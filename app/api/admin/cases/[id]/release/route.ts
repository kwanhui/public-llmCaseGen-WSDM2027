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
  if (row.status !== "approved" && row.status !== "released") {
    return NextResponse.json(
      { error: "approve_first", message: "Approve the case before releasing." },
      { status: 409 },
    );
  }

  const phases = (row.phasesJson as PhaseDefinition[]) ?? [];
  if (phases.length === 0) {
    return NextResponse.json({ error: "no_phases" }, { status: 409 });
  }
  const firstPhase = [...phases].sort((a, b) => a.order - b.order)[0];

  await db
    .update(cases)
    .set({
      status: "released",
      currentPhaseId: row.currentPhaseId ?? firstPhase.id,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, id));

  await logCaseEvent({
    caseId: id,
    eventType: "released",
    metadata: { firstPhaseId: firstPhase.id },
  });

  return NextResponse.json({ ok: true, currentPhaseId: row.currentPhaseId ?? firstPhase.id });
}
