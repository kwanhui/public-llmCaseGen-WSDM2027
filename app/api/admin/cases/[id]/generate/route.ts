import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { generateCase, checkConceptCoverage } from "@/lib/generation/generate-case";
import { groundingUtilisation } from "@/lib/retrieval/grounding";
import { CaseContentSchema, type CaseContent } from "@/lib/generation/schema";
import { runGenerationAttempts, type AttemptFailure } from "@/lib/generation/generate-attempts";
import { logCaseEvent } from "@/lib/case/events";
import { seededCaseGuard } from "@/lib/case/seeded";
import { RETRIEVAL_WEAK_SCORE } from "@/lib/retrieval/embedding-provider";
import type { CaseInput } from "@/lib/disciplines/types";

// The retrieval provenance is a list of display strings, one per note, of the
// form "corpus:<note id> (<score>)". Anything reading the log for analysis then
// has to parse them, so the same notes are logged again as numbers. The strings
// stay: the provenance export reads them.
function parseRetrievalScores(
  provenance: string[],
): { id: string; score: number; weak: boolean }[] {
  const out: { id: string; score: number; weak: boolean }[] = [];
  for (const raw of provenance) {
    const m = raw.match(/^corpus:(\S+)\s+\(([\d.]+)\)$/);
    if (!m) continue;
    const score = Number(m[2]);
    if (!Number.isFinite(score)) continue;
    out.push({ id: m[1], score, weak: score < RETRIEVAL_WEAK_SCORE });
  }
  return out;
}

// The part of the draft each schema path belongs to, in the words the editor
// uses, so a failure message names what came back wrong.
const FIELD_LABEL: Record<string, string> = {
  scenario: "the scenario",
  discussionQuestions: "the discussion questions",
  modelAnswers: "the model answers",
  rubric: "the rubric",
  glossary: "the key terms",
};

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// One sentence naming the reason, when the server knows it. An empty string
// when it does not, so the caller can leave the sentence out.
function failureReason(failure: AttemptFailure | null): string {
  if (!failure) return "";
  if (failure.reason === "schema_validation") {
    const parts = Array.from(
      new Set(failure.detail.map((d) => FIELD_LABEL[d.split(".")[0]]).filter(Boolean)),
    );
    return parts.length > 0
      ? `The last draft did not pass the checks on ${listPhrase(parts)}.`
      : "The last draft did not pass the checks on its structure.";
  }
  const message = failure.detail[0] ?? "";
  if (failure.reason === "timeout" || /timeout|timed out|aborted|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return "The model did not answer in time.";
  }
  return message ? `The model provider reported: ${message}` : "";
}

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
  if (row.status === "released" || row.status === "approved") {
    return NextResponse.json(
      { error: "case_finalised" },
      { status: 409 },
    );
  }

  await db
    .update(cases)
    .set({ status: "generating", updatedAt: new Date() })
    .where(eq(cases.id, id));
  await logCaseEvent({ caseId: id, eventType: "generation_started" });

  const input: CaseInput = {
    discipline: row.discipline as CaseInput["discipline"],
    learningObjective: row.learningObjective,
    difficulty: row.difficulty as CaseInput["difficulty"],
    mustCoverConcepts: (row.mustCoverConcepts as string[]) ?? [],
    targetLearnerProfile: row.targetLearnerProfile as CaseInput["targetLearnerProfile"],
  };

  // Two attempts. A structured-output failure (the model returns something the
  // schema rejects, or a draft too thin to open in the editor) is usually
  // transient, and a second call costs less than handing the instructor a
  // schema error. Each attempt is validated against the stricter editor and
  // student schema before it can be kept: the generation schema has no
  // per-field minimums, so a thin draft passes generation yet dead-ends at
  // step 4. Each attempt also has a time limit, and the two together stay
  // inside the route's maxDuration (lib/generation/generate-attempts.ts), so a
  // stalled model call ends in a reply rather than in the platform's HTTP 504.
  type Kept = {
    output: Awaited<ReturnType<typeof generateCase>>["output"];
    contentJson: CaseContent;
    provenance: string[];
  };
  const run = await runGenerationAttempts(
    (abortSignal) => generateCase(input, undefined, { abortSignal }),
    (result) => {
      const validated = CaseContentSchema.safeParse({ schemaVersion: 1, ...result.output });
      if (validated.success) {
        return {
          ok: true as const,
          value: { output: result.output, contentJson: validated.data, provenance: result.provenance } satisfies Kept,
        };
      }
      return {
        ok: false as const,
        failure: {
          reason: "schema_validation" as const,
          detail: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      };
    },
  );
  console.info(
    `[generate] case ${id}: ${run.attempts
      .map((a) => `attempt ${a.attempt} ${a.outcome} in ${(a.ms / 1000).toFixed(1)} s`)
      .join(", ")}`,
  );

  if (!run.value) {
    const lastFailure = run.lastFailure;
    await db
      .update(cases)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(cases.id, id));
    await logCaseEvent({
      caseId: id,
      eventType: "generation_failed",
      metadata: {
        reason: lastFailure?.reason ?? "unknown",
        detail: lastFailure?.detail ?? [],
        attempts: run.attempts.length,
        attemptSeconds: run.attempts.map((a) => Math.round(a.ms / 100) / 10),
      },
    });
    const tried =
      run.attempts.length > 1
        ? "The model did not return a usable draft, on the first attempt or on the automatic retry."
        : "The model did not return a usable draft, and there was no time left for the automatic retry.";
    return NextResponse.json(
      {
        error: "generation_failed",
        message: [
          tried,
          failureReason(lastFailure),
          "Nothing was saved and the case is unchanged. Try again in a moment. If it keeps failing, shorten the learning objective or reduce the number of must-cover concepts.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      { status: 502 },
    );
  }

  const { output, contentJson, provenance } = run.value;
  const coverage = checkConceptCoverage(output, input.mustCoverConcepts);
  const grounding = groundingUtilisation(output, provenance, input);
  const retrievalScores = parseRetrievalScores(provenance);
  await db
    .update(cases)
    .set({ contentJson, status: "editing", updatedAt: new Date() })
    .where(eq(cases.id, id));
  await logCaseEvent({
    caseId: id,
    eventType: "generation_completed",
    metadata: {
      scenarioLen: output.scenario.length,
      questionCount: output.discussionQuestions.length,
      retrieval: provenance,
      retrievalScores,
      conceptsCovered: coverage.covered,
      conceptsMissing: coverage.missing,
      groundingUsed: grounding.used,
      groundingCountable: grounding.countable,
      groundingTotal: grounding.total,
    },
  });

  return NextResponse.json({ contentJson });
}
