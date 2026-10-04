import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { logCaseEvent } from "@/lib/case/events";
import { seededCaseGuard } from "@/lib/case/seeded";

// Co-teaching handoff note. A course is often shared between instructors, and
// this gives one of them a place to leave context for the others ("I tuned
// the rubric for the part-time cohort", "hold release until week 6"). It
// records a short internal note against the case as an event, so it joins the
// same audit trail and needs no new table. The latest note is what the case
// page shows.
const NoteSchema = z.object({ note: z.string().max(2000) });

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
  const parsed = NoteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });

  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await logCaseEvent({
    caseId: id,
    eventType: "instructor_note",
    metadata: {
      note: parsed.data.note.trim(),
      author: (session.user as { name?: string; email?: string }).name ?? (session.user as { email?: string }).email ?? "instructor",
    },
  });

  return NextResponse.json({ ok: true });
}
