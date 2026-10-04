import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseComparisons, caseEvents, cases } from "@/lib/db/schema";
import { CaseContentSchema } from "@/lib/generation/schema";
import type { CaseInput } from "@/lib/disciplines/types";
import {
  type EditSummary,
  buildComparisonView,
  type CachedComparison,
  type ComparisonView,
} from "./compare";
import type { GenerationOutput } from "./schema";

// Database access for the contrastive view, shared by the compare page (which
// renders the cached result server-side) and the compare API (which serves the
// same shape over HTTP and regenerates on POST).

export interface CaseForComparison {
  id: string;
  input: CaseInput;
  status: string;
}

export async function loadCaseForComparison(
  caseId: string,
  instructorId: string,
): Promise<{ row: typeof cases.$inferSelect } | null> {
  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.instructorId, instructorId)));
  return row ? { row } : null;
}

export function caseInputFromRow(row: typeof cases.$inferSelect): CaseInput {
  return {
    discipline: row.discipline as CaseInput["discipline"],
    learningObjective: row.learningObjective,
    difficulty: row.difficulty as CaseInput["difficulty"],
    mustCoverConcepts: (row.mustCoverConcepts as string[]) ?? [],
    targetLearnerProfile: row.targetLearnerProfile as CaseInput["targetLearnerProfile"],
  };
}

// Retrieval provenance from the case's most recent completed generation. This
// is what the PersCase arm's grounding column is computed against, so the
// figure reflects the passages that actually conditioned the approved draft.
export async function loadTeamProvenance(caseId: string): Promise<string[] | null> {
  const [event] = await db
    .select({ metadata: caseEvents.metadata })
    .from(caseEvents)
    .where(
      and(eq(caseEvents.caseId, caseId), eq(caseEvents.eventType, "generation_completed")),
    )
    .orderBy(desc(caseEvents.timestampIso))
    .limit(1);
  const meta = event?.metadata as { retrieval?: unknown } | null;
  return Array.isArray(meta?.retrieval) ? (meta.retrieval as string[]) : null;
}

export async function loadCachedComparison(
  caseId: string,
): Promise<CachedComparison | null> {
  const [row] = await db
    .select()
    .from(caseComparisons)
    .where(eq(caseComparisons.caseId, caseId));
  if (!row) return null;
  return {
    plainText: row.plainText,
    structuredJson: row.structuredJson as GenerationOutput,
    structuredProvenance: (row.structuredProvenance as string[]) ?? [],
    modelId: row.modelId,
    generatedAt: row.generatedAt,
  };
}

export async function saveComparison(args: {
  caseId: string;
  plainText: string;
  structuredJson: GenerationOutput;
  structuredProvenance: string[];
  modelId: string;
}): Promise<Date> {
  const generatedAt = new Date();
  await db
    .insert(caseComparisons)
    .values({ ...args, generatedAt })
    .onConflictDoUpdate({
      target: caseComparisons.caseId,
      set: {
        plainText: args.plainText,
        structuredJson: args.structuredJson,
        structuredProvenance: args.structuredProvenance,
        modelId: args.modelId,
        generatedAt,
      },
    });
  return generatedAt;
}

// Assemble the full view for one case from what is already stored. Makes no
// model calls: an empty cache simply yields a view with the PersCase arm only.
export async function comparisonViewForCase(
  row: typeof cases.$inferSelect,
): Promise<ComparisonView> {
  const input = caseInputFromRow(row);
  const parsed = row.contentJson ? CaseContentSchema.safeParse(row.contentJson) : null;
  const teamContent = parsed?.success ? parsed.data : null;
  const [teamProvenance, cached, edits] = await Promise.all([
    loadTeamProvenance(row.id),
    loadCachedComparison(row.id),
    loadEditSummary(row.id),
  ]);
  return buildComparisonView({
    caseId: row.id,
    input,
    teamContent,
    teamProvenance,
    cached,
    edits,
  });
}

// What the instructor did to the draft after generation, from the event log:
// in-place saves that changed a section, section regenerations, and sections
// whose regenerated text was put back. Null when nothing was done.
export async function loadEditSummary(caseId: string): Promise<EditSummary | null> {
  const rows = await db
    .select({ eventType: caseEvents.eventType, metadata: caseEvents.metadata })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, caseId))
    .orderBy(asc(caseEvents.id));
  const summary: EditSummary = {
    saves: 0,
    sectionsChanged: [],
    regenerations: 0,
    regeneratedSections: [],
    restoredSections: [],
  };
  const add = (list: string[], v: unknown) => {
    if (typeof v === "string" && !list.includes(v)) list.push(v);
  };
  for (const r of rows) {
    const m = (r.metadata ?? {}) as { sectionsChanged?: unknown; section?: unknown };
    if (r.eventType === "edit_saved") {
      const changed = Array.isArray(m.sectionsChanged) ? m.sectionsChanged : [];
      if (changed.length === 0) continue;
      summary.saves += 1;
      for (const c of changed) add(summary.sectionsChanged, c);
    } else if (r.eventType === "section_regenerated") {
      summary.regenerations += 1;
      add(summary.regeneratedSections, m.section);
    } else if (r.eventType === "section_restored") {
      add(summary.restoredSections, m.section);
    }
  }
  return summary.saves + summary.regenerations + summary.restoredSections.length > 0
    ? summary
    : null;
}
