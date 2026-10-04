// Count the retrieved notes that each committed sample output reflects, with
// the same groundingUtilisation function the app calls at generation time. It
// reads demo/sample-outputs and generates nothing, so it needs no API key and
// no database.
//
// Three readings are printed and written for every case: the rule the system
// uses, under which a distinctive tag counts only if the brief did not already
// supply it; the earlier rule, under which any distinctive tag counted; and the
// original any-tag rule, under which generic tags counted too. The first is
// reported over the countable notes, the notes that have a tag which could
// count at all.
//
//   pnpm grounding-report

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  GROUNDING_RULE,
  distinctiveTagSummary,
  groundingUtilisation,
} from "../lib/retrieval/grounding";
import { resultProvenance } from "./result-provenance";

const DIR = join(process.cwd(), "demo/sample-outputs");
const OUT = join(process.cwd(), "demo/grounding-utilisation.json");

function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  const perCase = [];
  let used = 0;
  let countable = 0;
  let usedDistinctiveTag = 0;
  let usedAnyTag = 0;
  let total = 0;
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    // The stored draft for the demo's scripted preset sits in the same
    // directory but is not one of the three sample generations; skip it.
    if (!r.output || !r.input) continue;
    const g = groundingUtilisation(r.output, r.provenance, r.input);
    perCase.push({
      discipline: r.input.discipline,
      used: g.used,
      countable: g.countable,
      usedDistinctiveTag: g.usedDistinctiveTag,
      usedAnyTag: g.usedAnyTag,
      total: g.total,
      notes: g.notes.map((n) => ({
        id: n.id,
        caseDesign: n.caseDesign,
        countable: n.countable,
        reflected: n.reflected,
        reflectedDistinctiveTag: n.reflectedDistinctiveTag,
        reflectedAnyTag: n.reflectedAnyTag,
        matchedTags: n.matchedTags,
        briefMatches: n.briefMatches,
        genericMatches: n.genericMatches,
        countableTags: n.countableTags,
        distinctiveTags: n.distinctiveTags,
        tags: n.tags,
      })),
    });
    used += g.used;
    countable += g.countable;
    usedDistinctiveTag += g.usedDistinctiveTag;
    usedAnyTag += g.usedAnyTag;
    total += g.total;
    console.log(
      `${r.input.discipline}: ${g.used}/${g.countable} countable passages reflected ` +
        `(${g.total} retrieved; ${g.usedDistinctiveTag}/${g.total} under the earlier ` +
        `distinctive-tag rule, ${g.usedAnyTag}/${g.total} under the original any-tag rule)`,
    );
  }
  const report = {
    ...resultProvenance(),
    method: GROUNDING_RULE,
    distinctiveTagMethod:
      "lexical: the earlier distinctive-tag rule, under which a retrieved passage counted as reflected if one of its distinctive tags appeared in the generated case text, whether or not the brief supplied that tag",
    anyTagMethod:
      "lexical: the original any-tag rule, under which a retrieved passage counted as reflected if any of its corpus tags appeared in the generated case text, generic tags included",
    source:
      "demo/sample-outputs, the raw generations. The seeded demo cases carry instructor edits applied on top of these (see scripts/seed-demo.ts), so their figures differ.",
    corpus: distinctiveTagSummary(),
    perCase,
    totalUsed: used,
    totalCountable: countable,
    totalUsedDistinctiveTag: usedDistinctiveTag,
    totalUsedAnyTag: usedAnyTag,
    totalRetrieved: total,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `\noverall: ${used}/${countable} countable reflected (${total} retrieved), ` +
      `${usedDistinctiveTag}/${total} under the earlier distinctive-tag rule, ${usedAnyTag}/${total} ` +
      `under the original any-tag rule -> wrote ${OUT}`,
  );
}

main();
