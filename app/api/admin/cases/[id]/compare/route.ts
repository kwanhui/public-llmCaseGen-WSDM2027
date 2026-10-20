import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { logCaseEvent } from "@/lib/case/events";
import { isSeededCase, SEEDED_BASELINES_MESSAGE } from "@/lib/case/seeded";
import {
  generatePlainCase,
  generateStructuredNoRetrieval,
} from "@/lib/generation/compare";
import {
  caseInputFromRow,
  comparisonViewForCase,
  loadCaseForComparison,
  saveComparison,
} from "@/lib/generation/compare-store";
import {
  ModelTimeLimitError,
  callModelWithinLimits,
  retryAfterTimeoutOnly,
} from "@/lib/generation/generate-attempts";

// GET  returns the cached contrastive view for a case (no model calls).
// POST regenerates the two on-demand arms and overwrites the cache.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;

  const found = await loadCaseForComparison(id, instructorId);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(await comparisonViewForCase(found.row));
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;

  // The seeded cases ship with committed baselines, and the readings in
  // demo/comparison-readings.json are read off them, so a visitor re-running
  // them would leave the two disagreeing.
  if (isSeededCase(id)) {
    return NextResponse.json(
      { error: "seeded_baselines_fixed", message: SEEDED_BASELINES_MESSAGE },
      { status: 403 },
    );
  }

  const found = await loadCaseForComparison(id, instructorId);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const input = caseInputFromRow(found.row);

  // Both arms run against the same brief; running them together keeps the
  // wall-clock cost close to a single generation. Each arm runs under the time
  // limits of the Generate case route (lib/generation/generate-attempts.ts):
  // a stalled call is stopped and tried once more if time allows, so the route
  // replies rather than the platform ending it with HTTP 504. A call that
  // fails for any other reason is not retried, as before. Nothing is saved
  // unless both arms come back, so the baselines on the page stay as they were.
  let plain;
  let structured;
  try {
    [plain, structured] = await Promise.all([
      callModelWithinLimits(
        `compare ${id} plain`,
        (abortSignal) => generatePlainCase(input, { abortSignal }),
        { retryError: retryAfterTimeoutOnly },
      ),
      callModelWithinLimits(
        `compare ${id} structured`,
        (abortSignal) => generateStructuredNoRetrieval(input, { abortSignal }),
        { retryError: retryAfterTimeoutOnly },
      ),
    ]);
  } catch (err) {
    const reason =
      err instanceof ModelTimeLimitError
        ? err.message
        : `The model provider reported: ${err instanceof Error ? err.message : "an unknown error"}.`;
    return NextResponse.json(
      {
        error: "comparison_failed",
        message: `The baselines could not be generated. ${reason} Nothing was saved, and the baselines shown before are unchanged. Try again in a moment.`,
      },
      { status: 502 },
    );
  }

  await saveComparison({
    caseId: id,
    plainText: plain.text,
    structuredJson: structured.output,
    structuredProvenance: structured.provenance,
    modelId: plain.modelId,
  });

  const view = await comparisonViewForCase(found.row);
  // Logged so that contrastive runs can be counted and dated from the event log.
  await logCaseEvent({
    caseId: id,
    eventType: "comparison_run",
    metadata: {
      modelId: plain.modelId,
      arms: view.arms.map((a) => a.id),
      readings: Object.fromEntries(
        view.arms.map((a) => [
          a.id,
          {
            conceptsCovered: a.signals.conceptsCovered.length,
            conceptsTotal:
              a.signals.conceptsCovered.length + a.signals.conceptsMissing.length,
            notesReflected: a.signals.grounding?.used ?? null,
            notesTotal: a.signals.grounding?.total ?? null,
            wordCount: a.signals.wordCount,
          },
        ]),
      ),
    },
  });

  return NextResponse.json(view);
}
