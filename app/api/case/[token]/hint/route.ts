import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseEvents, caseVariants, cases } from "@/lib/db/schema";
import { CaseContentSchema } from "@/lib/generation/schema";
import { generateHint, MAX_HINTS_PER_PHASE } from "@/lib/generation/hint";
import {
  ModelTimeLimitError,
  callModelWithinLimits,
  retryAfterTimeoutOnly,
} from "@/lib/generation/generate-attempts";
import { logCaseEvent } from "@/lib/case/events";
import type { PhaseDefinition } from "@/lib/disciplines/types";
import { hashFingerprint } from "@/lib/logging/hmac";
import { enforceRateLimit } from "@/lib/ratelimit";
import { ROUTE_COST, ROUTE_MAX_OUTPUT_TOKENS } from "@/lib/llm/route-limits";

// Student-facing graduated hint: one nudge short of the model answer, for a
// student who is stuck but does not want the full answer revealed. Token-scoped
// (no login), like the other student routes.
//
// The page sends the open phase and the hints it already holds, so each hint is
// more specific than the last. Hints are not stored; the ladder lives in the
// page for as long as it is open.
//
// The limit of three hints per phase is also checked here, because the list the
// page sends can be emptied. Each hint_requested event carries a one-way hash
// of the requesting device (address and browser, the same hash as the view
// events), and a device that already has three hints for the phase on this
// team link is refused. Without PSEUDONYM_SALT there is no hash, and only the
// page's list is checked.
const RequestSchema = z.object({
  answer: z.string().max(20000).optional(),
  phaseId: z.string().min(1).max(80).optional(),
  previousHints: z.array(z.string().max(2000)).max(MAX_HINTS_PER_PHASE).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const previousHints = parsed.data.previousHints ?? [];
  if (previousHints.length >= MAX_HINTS_PER_PHASE) {
    return NextResponse.json(
      {
        error: "hint_limit",
        message: `You have used all ${MAX_HINTS_PER_PHASE} hints for this phase.`,
      },
      { status: 409 },
    );
  }

  const [row] = await db
    .select({
      variantId: caseVariants.id,
      caseId: caseVariants.caseId,
      contentJson: caseVariants.contentJson,
      status: cases.status,
      phasesJson: cases.phasesJson,
      currentPhaseId: cases.currentPhaseId,
    })
    .from(caseVariants)
    .innerJoin(cases, eq(caseVariants.caseId, cases.id))
    .where(eq(caseVariants.inviteToken, token));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.status !== "released") {
    return NextResponse.json({ error: "not_released" }, { status: 409 });
  }

  const content = CaseContentSchema.safeParse(row.contentJson);
  if (!content.success) return NextResponse.json({ error: "invalid_content" }, { status: 422 });

  const phases = (row.phasesJson as PhaseDefinition[]) ?? [];
  const wanted = parsed.data.phaseId ?? row.currentPhaseId;
  const phaseRow = phases.find((p) => p.id === wanted);
  const phase = phaseRow
    ? {
        id: phaseRow.id,
        label: phaseRow.studentTitle,
        prompt: phaseRow.studentPrompt,
        disciplineHint: phaseRow.disciplineHint,
      }
    : undefined;

  const viewerHash = deviceHash(req);
  if (viewerHash) {
    const used = await hintsGiven(row.variantId, phase?.id ?? null, viewerHash);
    if (used >= MAX_HINTS_PER_PHASE) {
      return NextResponse.json(
        {
          error: "hint_limit",
          message: `You have used all ${MAX_HINTS_PER_PHASE} hints for this phase.`,
        },
        { status: 409 },
      );
    }
  }

  const limited = enforceRateLimit(req, ROUTE_COST.hint, "case", token);
  if (limited) return limited;

  // Under the time limits of the Generate case route
  // (lib/generation/generate-attempts.ts): a stalled call is stopped and tried
  // once more if time allows, so the student gets a reply rather than the
  // platform's HTTP 504. The message is written for the student.
  let hint;
  try {
    hint = await callModelWithinLimits(
      "case/hint",
      (abortSignal) =>
        generateHint(content.data, parsed.data.answer ?? "", {
          phase,
          previousHints,
          maxTokens: ROUTE_MAX_OUTPUT_TOKENS.hint,
          abortSignal,
        }),
      { retryError: retryAfterTimeoutOnly },
    );
  } catch (err) {
    console.warn(`[case/hint] ${err instanceof Error ? err.message : "Unknown error"}`);
    return NextResponse.json(
      {
        error: "hint_failed",
        message:
          err instanceof ModelTimeLimitError
            ? "The hint took too long to write. Please try again in a moment."
            : "Could not get a hint. Please try again in a moment.",
      },
      { status: 502 },
    );
  }

  await logCaseEvent({
    caseId: row.caseId,
    variantId: row.variantId,
    eventType: "hint_requested",
    metadata: {
      phaseId: phase?.id,
      step: previousHints.length + 1,
      ...(viewerHash ? { viewerHash } : {}),
    },
  });

  return NextResponse.json({
    hint: hint.hint,
    level: hint.level,
    levelName: hint.levelName,
    index: previousHints.length + 1,
    total: MAX_HINTS_PER_PHASE,
  });
}

// The same one-way hash of address and browser that the view route logs, or
// null when PSEUDONYM_SALT is not set.
function deviceHash(req: Request): string | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  const ua = req.headers.get("user-agent") ?? "unknown";
  try {
    return hashFingerprint(`${ip}|${ua}`, process.env.PSEUDONYM_SALT ?? "");
  } catch {
    return null;
  }
}

// Hints already given to this device for this phase on this team link.
async function hintsGiven(
  variantId: string,
  phaseId: string | null,
  viewerHash: string,
): Promise<number> {
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(caseEvents)
    .where(
      and(
        eq(caseEvents.variantId, variantId),
        eq(caseEvents.eventType, "hint_requested"),
        sql`${caseEvents.metadata}->>'viewerHash' = ${viewerHash}`,
        phaseId === null
          ? sql`${caseEvents.metadata}->>'phaseId' IS NULL`
          : sql`${caseEvents.metadata}->>'phaseId' = ${phaseId}`,
      ),
    );
  return counted?.n ?? 0;
}
