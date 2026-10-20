import { NextResponse } from "next/server";
import { asTextFields } from "@/lib/generation/compare";
import { checkConceptCoverage } from "@/lib/generation/generate-case";
import { personaliseCaseContent } from "@/lib/generation/personalize";
import { describeGenerationModel } from "@/lib/llm/client";
import { differingSentences } from "@/lib/text/diff-sentences";
import {
  DEMO_COST,
  DEMO_MAX_OUTPUT_TOKENS,
  guardDemoRequest,
  invalid,
  modelFailed,
  readDemoJson,
  withTiming,
} from "@/lib/demo/guards";
import { DemoPersonaliseRequestSchema, type DemoPersonaliseResponse } from "@/lib/demo/contracts";
import { plainPersonalise, plainPersonaliseText } from "@/lib/demo/plain-arms";
import { withSchemaRetry } from "@/lib/demo/schema-retry";
import { callModelWithinLimits, retryAfterTimeoutOnly } from "@/lib/generation/generate-attempts";

// Public, unauthenticated. One team variant of a visitor's case, either through
// PersCase's personalisation prompt or through a single plain prompt, so the
// page can set the two side by side. Nothing is written to the database.
// Every model call runs under the time limits of the instructor's Generate
// case route (lib/generation/generate-attempts.ts).

export async function POST(req: Request) {
  const blocked = await guardDemoRequest(req, DEMO_COST.personalise);
  if (blocked) return blocked;

  const read = await readDemoJson(req);
  if (!read.ok) return read.response;
  const parsed = DemoPersonaliseRequestSchema.safeParse(read.body);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { arm, brief, base, team } = parsed.data;
  const maxTokens = DEMO_MAX_OUTPUT_TOKENS.personalise;

  try {
    // A plain draft is free text: one plain call, and the readings over the
    // whole text, as the draft's own readings are taken.
    if ("text" in base) {
      const { result: text, elapsedMs } = await withTiming(() =>
        callModelWithinLimits(
          "demo personalise/plain",
          (abortSignal) => plainPersonaliseText(base.text, team, maxTokens, abortSignal),
          { retryError: retryAfterTimeoutOnly },
        ),
      );
      return NextResponse.json({
        arm: "plain",
        kind: "text",
        text,
        coverage: checkConceptCoverage(asTextFields(text), brief.mustCoverConcepts),
        differingSentences: differingSentences(base.text, text),
        modelId: describeGenerationModel(),
        elapsedMs,
      } satisfies DemoPersonaliseResponse);
    }
    const { result: content, elapsedMs } = await withTiming(() =>
      withSchemaRetry(`personalise/${arm}`, (abortSignal) =>
        arm === "perscase"
          ? personaliseCaseContent({ base, caseInput: brief, override: team, maxTokens, abortSignal })
          : plainPersonalise(base, team, maxTokens, abortSignal),
      ),
    );
    return NextResponse.json({
      arm,
      kind: "structured",
      content,
      coverage: checkConceptCoverage(content, brief.mustCoverConcepts),
      differingSentences: differingSentences(base, content),
      modelId: describeGenerationModel(),
      elapsedMs,
    } satisfies DemoPersonaliseResponse);
  } catch (err) {
    return modelFailed(err);
  }
}
