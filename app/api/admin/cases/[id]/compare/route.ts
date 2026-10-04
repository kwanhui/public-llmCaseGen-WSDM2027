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
  // wall-clock cost close to a single generation.
  let plain;
  let structured;
  try {
    [plain, structured] = await Promise.all([
      generatePlainCase(input),
      generateStructuredNoRetrieval(input),
    ]);
  } catch (err) {
    return NextResponse.json(
      {
        error: "comparison_failed",
        message: err instanceof Error ? err.message : "Unknown error",
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
