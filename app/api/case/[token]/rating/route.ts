import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseVariants } from "@/lib/db/schema";
import { logCaseEvent } from "@/lib/case/events";

// Student-submitted case quality rating (1-5) with an optional short comment.
// Recorded against the case so an instructor, or a programme lead looking
// across cases, gets a direct quality signal from the people who used it.
// Token-scoped, no login, consistent with the other student routes.
const RatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const parsed = RatingSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });

  const [row] = await db
    .select({ variantId: caseVariants.id, caseId: caseVariants.caseId })
    .from(caseVariants)
    .where(eq(caseVariants.inviteToken, token));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await logCaseEvent({
    caseId: row.caseId,
    variantId: row.variantId,
    eventType: "quality_rated",
    metadata: {
      rating: parsed.data.rating,
      comment: parsed.data.comment?.trim() || undefined,
    },
  });

  return NextResponse.json({ ok: true });
}
