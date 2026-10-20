import { NextResponse } from "next/server";
import {
  generatePlainCase,
  generateStructuredNoRetrieval,
  plainSignals,
  structuredSignals,
} from "@/lib/generation/compare";
import { generateCase } from "@/lib/generation/generate-case";
import { regenerateSection } from "@/lib/generation/regenerate-section";
import { GenerationOutputSchema, type GenerationOutput } from "@/lib/generation/schema";
import { describeGenerationModel } from "@/lib/llm/client";
import { peekRateLimit } from "@/lib/ratelimit";
import {
  DEMO_COST,
  DEMO_MAX_OUTPUT_TOKENS,
  guardDemoRequest,
  invalid,
  modelFailed,
  readDemoJson,
  withTiming,
} from "@/lib/demo/guards";
import { DemoGenerateRequestSchema, type DemoGenerateResponse } from "@/lib/demo/contracts";
import {
  DemoRetrievalError,
  providerFromProvenance,
  retrieveForDemo,
} from "@/lib/demo/retrieval-trace";
import {
  DEMO_DRAFT_ATTEMPTS,
  DemoSchemaError,
  demoAttemptsOutcome,
  withSchemaRetry,
} from "@/lib/demo/schema-retry";
import {
  GENERATE_BUDGET_MS,
  callModelWithinLimits,
  isSchemaFailure,
  retryAfterTimeoutOnly,
  runGenerationAttempts,
  type Validation,
} from "@/lib/generation/generate-attempts";
import { regenerateEditorNote } from "@/lib/demo/regenerate";
import { STORED_FROM, storedDraftFor } from "@/lib/demo/stored-draft";

// Public, unauthenticated. One arm of the contrastive view for a visitor's
// brief. Nothing is written to the database and no case event is logged.
//
// The two baselines are scored for grounding against the PersCase arm's
// retrieved notes, which this request does not have when it runs a baseline.
// They therefore come back with grounding null; once the PersCase arm has
// returned its provenance, the page sends each baseline's text or content back
// with arm "signals" (no model call, no cost) to get the full readings.
//
// Arm "budget" (no model call, no cost) returns the visitor's remaining
// units, so that the page can refuse a step that would not fit before it
// sends any part of it.
//
// The page runs retrieval first, with arm "retrieve" (one embedding call, no
// model call, 1 unit), so that the trace is on screen while both columns
// generate. It then sends the provenance that arm returned with arm
// "perscase", which generates from exactly those notes rather than retrieving
// again.
//
// Arm "regenerate" (one structured call, 2 units) is the instructor's remedy
// for a concept the must-cover check flagged: it regenerates one section of
// the PersCase draft through the same library function as the instructor's
// regenerate-section route, with the flagged concepts named and an editor's
// note asking for them, grounded in the notes the draft was generated from.
//
// The perscase and regenerate arms make up to three attempts
// (DEMO_DRAFT_ATTEMPTS), all under the one charge the guard took for the
// request. Every model and embedding call here runs under the time limits of
// the instructor's Generate case route (lib/generation/generate-attempts.ts),
// inside the route's maxDuration in vercel.json. When every attempt of the
// perscase arm fails or runs out of time and the brief is the scripted
// preset's, the arm returns the stored draft of an earlier run of that brief,
// marked `stored`, with its readings taken against this request's notes
// (lib/demo/stored-draft.ts).

// The regenerate arm's attempts. A structured-output failure is retried, as
// withSchemaRetry does; so is a merged draft that fails the output schema or
// that no longer pairs one model answer with each question, the retry then
// stating the count as the instructor's route does. The last failure is
// reported as a schema failure.
async function regenerateWithRetry(
  args: Omit<Parameters<typeof regenerateSection>[0], "answerCountRetry">,
  content: GenerationOutput,
): Promise<GenerationOutput> {
  const paired = args.section === "discussionQuestions" || args.section === "modelAnswers";
  let countRetry = false;
  const fail = (detail: string): Validation<GenerationOutput> => ({
    ok: false,
    failure: { reason: "schema_validation", detail: [detail] },
  });
  const run = await runGenerationAttempts(
    (abortSignal) =>
      regenerateSection({
        ...args,
        answerCountRetry: countRetry,
        options: { ...args.options, abortSignal },
      }),
    ({ patch }) => {
      // The questions are regenerated with their answers; a reply with new
      // questions and no answers would leave the old answers under them.
      if (args.section === "discussionQuestions" && !(patch.discussionQuestions && patch.modelAnswers)) {
        return fail("questions returned without their answers");
      }
      const merged = GenerationOutputSchema.safeParse({ ...content, ...patch });
      if (!merged.success) return fail("merged draft failed the schema");
      if (paired && merged.data.discussionQuestions.length !== merged.data.modelAnswers.length) {
        countRetry = true;
        return fail(
          `${merged.data.discussionQuestions.length} questions, ${merged.data.modelAnswers.length} answers`,
        );
      }
      return { ok: true, value: merged.data };
    },
    { attempts: DEMO_DRAFT_ATTEMPTS, retryError: isSchemaFailure },
  );
  if (run.lastFailure?.reason === "schema_validation") {
    console.warn(`[demo] generate/regenerate: last attempt not usable: ${run.lastFailure.detail[0]}`);
  }
  return demoAttemptsOutcome("generate/regenerate", run);
}

export async function POST(req: Request) {
  const read = await readDemoJson(req);
  if (!read.ok) return read.response;

  // The cost depends on the arm, so peek at it before the guard runs. An
  // unknown arm is charged as a generation and then rejected by validation.
  const armPeek = (read.body as { arm?: unknown } | null)?.arm;
  const cost =
    armPeek === "signals" || armPeek === "budget"
      ? 0
      : armPeek === "retrieve"
        ? DEMO_COST.retrieve
        : armPeek === "regenerate"
          ? DEMO_COST.regenerate
          : DEMO_COST.generate;
  const blocked = await guardDemoRequest(req, cost);
  if (blocked) return blocked;

  const parsed = DemoGenerateRequestSchema.safeParse(read.body);
  if (!parsed.success) return invalid(parsed.error.issues);
  const body = parsed.data;

  // The visitor's allowance, read without charging (see lib/ratelimit.ts).
  if (body.arm === "budget") {
    return NextResponse.json({
      arm: "budget",
      ...peekRateLimit(req),
    } satisfies DemoGenerateResponse);
  }

  const brief = body.brief;
  const maxTokens = DEMO_MAX_OUTPUT_TOKENS.generate;

  if (body.arm === "signals") {
    const signals =
      body.text !== undefined
        ? plainSignals(body.text, brief, body.provenance)
        : structuredSignals(body.content!, brief, body.provenance);
    return NextResponse.json({ arm: "signals", signals } satisfies DemoGenerateResponse);
  }

  try {
    if (body.arm === "retrieve") {
      const { trace, provenance } = await callModelWithinLimits(
        "demo generate/retrieve",
        (abortSignal) => retrieveForDemo(brief, { abortSignal }),
        { retryError: retryAfterTimeoutOnly },
      );
      return NextResponse.json({
        arm: "retrieve",
        retrieval: trace,
        provenance,
      } satisfies DemoGenerateResponse);
    }

    if (body.arm === "plain") {
      const { result, elapsedMs } = await withTiming(() =>
        callModelWithinLimits(
          "demo generate/plain",
          (abortSignal) => generatePlainCase(brief, { maxTokens, abortSignal }),
          { retryError: retryAfterTimeoutOnly },
        ),
      );
      return NextResponse.json({
        arm: "plain",
        kind: "text",
        text: result.text,
        provenance: [],
        retrieval: null,
        signals: plainSignals(result.text, brief, null),
        modelId: result.modelId,
        elapsedMs,
      } satisfies DemoGenerateResponse);
    }

    if (body.arm === "structured") {
      const { result, elapsedMs } = await withTiming(() =>
        withSchemaRetry("generate/structured", (abortSignal) =>
          generateStructuredNoRetrieval(brief, { maxTokens, abortSignal }),
        ),
      );
      return NextResponse.json({
        arm: "structured",
        kind: "structured",
        content: result.output,
        provenance: [],
        retrieval: null,
        signals: structuredSignals(result.output, brief, null),
        modelId: describeGenerationModel(),
        elapsedMs,
      } satisfies DemoGenerateResponse);
    }

    if (body.arm === "regenerate") {
      // The notes the draft was generated from, rebuilt as the perscase arm
      // rebuilds them, so that no embedding call is made.
      const { provider } = providerFromProvenance(brief, body.provenance);
      const { result, elapsedMs } = await withTiming(() =>
        regenerateWithRetry(
          {
            input: brief,
            currentContent: { schemaVersion: 1, ...body.content },
            section: body.section,
            editorNote: regenerateEditorNote(body.missingConcepts),
            missingConcepts: body.missingConcepts,
            provider,
            options: { maxTokens },
          },
          body.content,
        ),
      );
      return NextResponse.json({
        arm: "regenerate",
        section: body.section,
        content: result,
        signals: structuredSignals(result, brief, body.provenance),
        modelId: describeGenerationModel(),
        elapsedMs,
      } satisfies DemoGenerateResponse);
    }

    // perscase: the notes the retrieve arm returned, or retrieval here (timed
    // with generation, as the visitor waits for both).
    const given = body.provenance;
    const started = Date.now();
    const { provider, trace, provenance } =
      given !== undefined
        ? { ...providerFromProvenance(brief, given), provenance: given }
        : await callModelWithinLimits(
            "demo generate/perscase retrieve",
            (abortSignal) => retrieveForDemo(brief, { abortSignal }),
            { attempts: 1 },
          );
    let generated: Awaited<ReturnType<typeof generateCase>>;
    try {
      // Only the model call is retried; the retrieval above runs once, and the
      // attempts have what is left of the budget after it.
      generated = await withSchemaRetry(
        "generate/perscase",
        (abortSignal) => generateCase(brief, provider, { maxTokens, abortSignal }),
        { attempts: DEMO_DRAFT_ATTEMPTS, budgetMs: GENERATE_BUDGET_MS - (Date.now() - started) },
      );
    } catch (err) {
      const stored = err instanceof DemoSchemaError ? storedDraftFor(brief) : null;
      if (!stored || !(err instanceof DemoSchemaError)) throw err;
      console.warn(`[demo] generate/perscase: returned the stored draft of ${stored.caseId}`);
      return NextResponse.json({
        arm: "perscase",
        kind: "structured",
        content: stored.content,
        provenance,
        retrieval: trace,
        signals: structuredSignals(stored.content, brief, provenance),
        modelId: describeGenerationModel(),
        elapsedMs: Date.now() - started,
        stored: true,
        storedFrom: STORED_FROM,
        failedAttempts: err.attempts,
      } satisfies DemoGenerateResponse);
    }
    const result = { ...generated, trace };
    const elapsedMs = Date.now() - started;
    return NextResponse.json({
      arm: "perscase",
      kind: "structured",
      content: result.output,
      provenance: result.provenance,
      retrieval: result.trace,
      signals: structuredSignals(result.output, brief, result.provenance),
      modelId: describeGenerationModel(),
      elapsedMs,
    } satisfies DemoGenerateResponse);
  } catch (err) {
    if (err instanceof DemoRetrievalError) {
      return NextResponse.json(
        { error: "retrieval_failed", message: err.message },
        { status: 502 },
      );
    }
    return modelFailed(err);
  }
}
