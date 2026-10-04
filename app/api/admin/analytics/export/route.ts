import { NextResponse } from "next/server";
import { and, eq, desc, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases, caseVariants, caseEvents, studentResponses } from "@/lib/db/schema";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(cols: unknown[]): string {
  return cols.map(csvEscape).join(",");
}

// How much a team wrote, rather than what they wrote. The verbatim text belongs
// in the per-case submissions export, which an instructor downloads to grade;
// an analytics file that travels between offices should not carry it.
function responseLength(contentJson: unknown): number {
  const c = contentJson as { text?: string; items?: string[] } | null;
  if (!c) return 0;
  if (Array.isArray(c.items)) return c.items.join(" ").length;
  return (c.text ?? "").length;
}

// `?caseId=` limits every table in the file to that one case, matching the case
// filter on the analytics page. Without it the file covers all of the signed-in
// instructor's cases. A case id the instructor does not own gives a file with
// headers and no rows, the same as an instructor with no cases.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const caseId = new URL(req.url).searchParams.get("caseId")?.trim() || undefined;

  const myCases = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.instructorId, instructorId),
        caseId ? eq(cases.id, caseId) : undefined,
      ),
    )
    .orderBy(desc(cases.createdAt));
  const caseIds = myCases.map((c) => c.id);

  const myVariants = caseIds.length === 0
    ? []
    : await db.select().from(caseVariants).where(inArray(caseVariants.caseId, caseIds));

  const myEvents = caseIds.length === 0
    ? []
    : await db
        .select()
        .from(caseEvents)
        .where(inArray(caseEvents.caseId, caseIds))
        .orderBy(desc(caseEvents.timestampIso));

  const variantIds = myVariants.map((v) => v.id);
  const myResponses = variantIds.length === 0
    ? []
    : await db
        .select()
        .from(studentResponses)
        .where(inArray(studentResponses.variantId, variantIds));

  const lines: string[] = [];
  lines.push(
    "# PersCase analytics export. This file holds four tables one after another, each under a '## NAME' line with its own header row, so it will not open as a single spreadsheet table. Split it on the '##' lines first.",
  );
  lines.push(
    "# Invite tokens and student answer text are left out on purpose: a token is live access to a team's case, and the answers belong in the submissions export instead.",
  );
  lines.push(`# generated: ${new Date().toISOString()}`);
  if (caseId) lines.push(`# case: ${caseId}`);
  lines.push("");
  lines.push("## CASES");
  lines.push(
    rowToCsv([
      "id",
      "discipline",
      "difficulty",
      "status",
      "learning_objective",
      "must_cover_concepts",
      "regeneration_count",
      "authoring_seconds_logged",
      "current_phase_id",
      "created_at",
      "approved_at",
    ]),
  );
  for (const c of myCases) {
    lines.push(
      rowToCsv([
        c.id,
        c.discipline,
        c.difficulty,
        c.status,
        c.learningObjective,
        Array.isArray(c.mustCoverConcepts) ? c.mustCoverConcepts.join("; ") : "",
        c.regenerationCount,
        c.authoringSecondsLogged ?? "",
        c.currentPhaseId ?? "",
        c.createdAt.toISOString(),
        c.authoringApprovedAt ? c.authoringApprovedAt.toISOString() : "",
      ]),
    );
  }

  lines.push("");
  lines.push("## VARIANTS");
  lines.push(
    rowToCsv([
      "id",
      "case_id",
      "view_count",
      "first_viewed_at",
      "last_viewed_at",
      "team_name",
      "industry",
      "role",
      "team_size",
    ]),
  );
  for (const v of myVariants) {
    // The learner profile is written out field by field rather than as its JSON
    // blob, so that prior knowledge stays out of the file. It is a property of
    // the case, not of a team, and exporting it per variant read as though each
    // team had its own.
    const p = v.learnerProfileJson as {
      displayName?: string | null;
      industry?: string;
      role?: string;
      teamSize?: number;
    };
    lines.push(
      rowToCsv([
        v.id,
        v.caseId,
        v.viewCount,
        v.firstViewedAt ? v.firstViewedAt.toISOString() : "",
        v.lastViewedAt ? v.lastViewedAt.toISOString() : "",
        p.displayName ?? "",
        p.industry ?? "",
        p.role ?? "",
        p.teamSize ?? "",
      ]),
    );
  }

  lines.push("");
  lines.push("## EVENTS");
  lines.push(rowToCsv(["timestamp", "case_id", "variant_id", "event_type", "metadata"]));
  for (const e of myEvents) {
    lines.push(
      rowToCsv([e.timestampIso, e.caseId, e.variantId ?? "", e.eventType, e.metadata]),
    );
  }

  lines.push("");
  lines.push("## STUDENT_RESPONSES");
  lines.push(
    rowToCsv(["variant_id", "phase_id", "activity_type", "characters", "updated_at"]),
  );
  for (const r of myResponses) {
    lines.push(
      rowToCsv([
        r.variantId,
        r.phaseId,
        r.activityType,
        responseLength(r.contentJson),
        r.updatedAt.toISOString(),
      ]),
    );
  }

  // A byte-order mark so Excel reads the file as UTF-8 and does not garble the
  // punctuation in learning objectives.
  const csv = "﻿" + lines.join("\n") + "\n";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="perscase-export-${caseId ? `${caseId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 40)}-` : ""}${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
