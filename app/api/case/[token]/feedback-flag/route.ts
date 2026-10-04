import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseVariants } from "@/lib/db/schema";
import { logCaseEvent } from "@/lib/case/events";

// A student who thinks the AI formative feedback was wrong can flag it. The
// feedback is explicitly not a grade, but without a way to disagree the learner
// has no voice; this records the disagreement against the case so the
// instructor can see where the automated feedback was contested. Token-scoped,
// no login, consistent with the other student routes.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [row] = await db
    .select({ variantId: caseVariants.id, caseId: caseVariants.caseId })
    .from(caseVariants)
    .where(eq(caseVariants.inviteToken, token));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await logCaseEvent({
    caseId: row.caseId,
    variantId: row.variantId,
    eventType: "feedback_disputed",
  });

  return NextResponse.json({ ok: true });
}
