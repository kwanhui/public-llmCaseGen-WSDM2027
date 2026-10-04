import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseVariants, cases } from "@/lib/db/schema";
import { hashFingerprint } from "@/lib/logging/hmac";
import { logCaseEvent } from "@/lib/case/events";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [row] = await db
    .select({
      id: caseVariants.id,
      caseId: caseVariants.caseId,
      status: cases.status,
    })
    .from(caseVariants)
    .innerJoin(cases, eq(caseVariants.caseId, cases.id))
    .where(eq(caseVariants.inviteToken, token));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  const ua = req.headers.get("user-agent") ?? "unknown";
  let viewerHash = "anon";
  try {
    viewerHash = hashFingerprint(`${ip}|${ua}`, process.env.PSEUDONYM_SALT ?? "");
  } catch {
    // PSEUDONYM_SALT is unset: log without a hash.
  }

  // Before release the visitor reaches a holding page and sees none of the
  // case, so this is not a view of the case. Log it under its own name and
  // leave the view counters alone.
  if (row.status !== "released") {
    await logCaseEvent({
      caseId: row.caseId,
      variantId: row.id,
      eventType: "variant_opened_before_release",
      metadata: { viewerHash },
    });
    return NextResponse.json({ ok: true, released: false });
  }

  const now = new Date();
  await db
    .update(caseVariants)
    .set({
      lastViewedAt: now,
      // The date goes into the statement as a UTC ISO string, the same form a
      // plain column assignment uses. Binding the Date object itself would let
      // the driver render it in the server's local zone, which this column,
      // having no time zone, would then store and read back as UTC.
      firstViewedAt: sql`COALESCE(${caseVariants.firstViewedAt}, ${now.toISOString()}::timestamp)`,
      viewCount: sql`${caseVariants.viewCount} + 1`,
    })
    .where(eq(caseVariants.id, row.id));

  await logCaseEvent({
    caseId: row.caseId,
    variantId: row.id,
    eventType: "variant_viewed",
    metadata: { viewerHash },
  });

  return NextResponse.json({ ok: true, released: true });
}
