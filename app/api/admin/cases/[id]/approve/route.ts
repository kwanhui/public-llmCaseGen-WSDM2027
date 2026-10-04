import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { CaseContentSchema } from "@/lib/generation/schema";
import { logCaseEvent } from "@/lib/case/events";
import { seededCaseGuard } from "@/lib/case/seeded";

const MAX_AUTHORING_SECONDS = 7200; // cap at 2h to defang walked-away timer

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
  if (!row.contentJson) {
    return NextResponse.json(
      { error: "no_content", message: "Generate the case before approving." },
      { status: 409 },
    );
  }
  const contentParse = CaseContentSchema.safeParse(row.contentJson);
  if (!contentParse.success) {
    return NextResponse.json(
      { error: "invalid_content", issues: contentParse.error.flatten() },
      { status: 422 },
    );
  }
  if (row.status === "approved" || row.status === "released") {
    return NextResponse.json({
      ok: true,
      authoringSeconds: row.authoringSecondsLogged,
      alreadyApproved: true,
    });
  }

  const now = new Date();
  const rawSeconds = Math.max(
    0,
    Math.floor((now.getTime() - row.authoringStartedAt.getTime()) / 1000),
  );
  const authoringSeconds = Math.min(rawSeconds, MAX_AUTHORING_SECONDS);

  await db
    .update(cases)
    .set({
      status: "approved",
      authoringApprovedAt: now,
      authoringSecondsLogged: authoringSeconds,
      updatedAt: now,
    })
    .where(eq(cases.id, id));

  await logCaseEvent({
    caseId: id,
    eventType: "approved",
    metadata: { authoringSeconds, capped: rawSeconds > MAX_AUTHORING_SECONDS },
  });

  return NextResponse.json({ ok: true, authoringSeconds });
}
