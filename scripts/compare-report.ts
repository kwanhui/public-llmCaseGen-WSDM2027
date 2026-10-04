// Export the contrastive view's readings to a file, so that the tables that
// report them can be checked against the repository. The readings otherwise
// exist only in the database: the two baselines are cached in case_comparisons
// and the third column is the case's current draft.
//
// This script only reads. It makes no model calls and writes nothing to the
// database. With no arguments it reports the three seeded released cases; pass
// case ids to report others.
//
//   pnpm compare-report
//   pnpm compare-report seed-case-finance <other-case-id>

import { config as loadEnv } from "dotenv";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { db } from "../lib/db/client";
import { cases } from "../lib/db/schema";
import { comparisonViewForCase } from "../lib/generation/compare-store";
import { COVERAGE_METHOD } from "../lib/generation/generate-case";
import { GROUNDING_RULE } from "../lib/retrieval/grounding";
import { resultProvenance } from "./result-provenance";

loadEnv({ path: ".env.local" });
loadEnv();

const OUT = join(process.cwd(), "demo/comparison-readings.json");

const DEFAULT_CASE_IDS = [
  "seed-case-finance",
  "seed-case-marketing",
  "seed-case-social-work",
];

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const caseIds = ids.length > 0 ? ids : DEFAULT_CASE_IDS;

  const rows = await db.select().from(cases).where(inArray(cases.id, caseIds));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const reported = [];
  for (const id of caseIds) {
    const row = byId.get(id);
    if (!row) {
      console.log(`${id}: no such case in this database, skipped`);
      continue;
    }
    const view = await comparisonViewForCase(row);
    const arms = view.arms.map((arm) => {
      const s = arm.signals;
      const sections = Object.values(s.sections).filter(Boolean).length;
      return {
        arm: arm.id,
        label: arm.label,
        conceptsCovered: s.conceptsCovered.length,
        conceptsTotal: s.conceptsCovered.length + s.conceptsMissing.length,
        conceptsMissing: s.conceptsMissing,
        notesReflected: s.grounding ? s.grounding.used : null,
        // The denominator of the reading above: the retrieved notes that have a
        // tag which could count at all.
        notesCountable: s.grounding ? s.grounding.countable : null,
        // The earlier distinctive-tag reading, where a distinctive tag counted whether or not
        // the brief supplied it.
        notesReflectedDistinctiveTag: s.grounding ? s.grounding.usedDistinctiveTag : null,
        // The original any-tag reading, where any tag counted, generic ones included.
        notesReflectedAnyTag: s.grounding ? s.grounding.usedAnyTag : null,
        notesTotal: s.grounding ? s.grounding.total : null,
        sectionsPresent: sections,
        sectionsTotal: 4,
        wordCount: s.wordCount,
      };
    });
    reported.push({
      caseId: row.id,
      discipline: row.discipline,
      status: row.status,
      learningObjective: row.learningObjective,
      mustCoverConcepts: (row.mustCoverConcepts as string[]) ?? [],
      baselinesCached: view.cached,
      // When the two baselines were generated, and with which model.
      comparisonGeneratedAt: view.generatedAt,
      modelId: view.modelId,
      arms,
    });
    const fmt = (a: (typeof arms)[number]) =>
      `${a.arm} ${a.conceptsCovered}/${a.conceptsTotal} concepts, ` +
      `${a.notesReflected ?? "-"}/${a.notesCountable ?? "-"} countable notes ` +
      `of ${a.notesTotal ?? "-"} retrieved ` +
      `(${a.notesReflectedDistinctiveTag ?? "-"} earlier distinctive-tag rule, ${a.notesReflectedAnyTag ?? "-"} any-tag rule), ` +
      `${a.wordCount} words`;
    console.log(`${row.id}: ${arms.map(fmt).join(" | ")}`);
  }

  const report = {
    ...resultProvenance(),
    source:
      "the cached baselines in case_comparisons and each case's current draft, read from the database. No model calls.",
    conceptMethod: COVERAGE_METHOD,
    noteMethod: GROUNDING_RULE,
    note: "The third arm is the case's current draft, instructor edits included, not a fresh generation. The two baselines are one sample each.",
    cases: reported,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nwrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
