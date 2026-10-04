import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseVariants, cases } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [row] = await db
    .select({
      caseId: cases.id,
      currentPhaseId: cases.currentPhaseId,
      status: cases.status,
      updatedAt: cases.updatedAt,
    })
    .from(caseVariants)
    .innerJoin(cases, eq(caseVariants.caseId, cases.id))
    .where(eq(caseVariants.inviteToken, token));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(
    {
      currentPhaseId: row.currentPhaseId,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
