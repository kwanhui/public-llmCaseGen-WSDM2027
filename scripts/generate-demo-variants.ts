// Generate the team variants of the three committed sample cases, one per team
// that scripts/seed-demo.ts seeds. The outputs are committed and loaded by the
// seed, so seeding and recording need no model call for the variants.
//
// The master each variant is written from is the instructor-edited case, not
// the raw generation: the same edit list the seed applies is applied here
// first. A variant therefore cannot carry a miss the master no longer has, and
// the seed loads these files as they stand rather than transforming them again.
//
//   pnpm tsx scripts/generate-demo-variants.ts
//   pnpm tsx scripts/generate-demo-variants.ts finance-retail.json
//
// With no arguments it writes every team's file. Naming files regenerates only
// those, which is how one variant that came back wrong is replaced.
//
// Writes demo/sample-variants/<file> and demo/sample-variants/provenance.json.

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CaseContentSchema } from "../lib/generation/schema";
import { personaliseCaseContent } from "../lib/generation/personalize";
import { describeGenerationModel } from "../lib/llm/client";
import type { CaseInput } from "../lib/disciplines/types";
import { FINANCE, MARKETING, SOCIAL_WORK, applyInstructorEdits } from "./seed-demo";
import type { CaseCfg } from "./seed-demo";
import { resultProvenance } from "./result-provenance";

loadEnv({ path: ".env.local" });
loadEnv();

const OUT_DIR = join(process.cwd(), "demo/sample-variants");
const CASES: CaseCfg[] = [FINANCE, MARKETING, SOCIAL_WORK];

async function main() {
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("-")));
  mkdirSync(OUT_DIR, { recursive: true });
  const written: string[] = [];

  for (const cfg of CASES) {
    const data = JSON.parse(
      readFileSync(join(process.cwd(), "demo/sample-outputs", cfg.sample), "utf8"),
    );
    // The master as the instructor approved it: the raw generation with this
    // case's edit list applied, and the curated key terms the seed attaches.
    const base = CaseContentSchema.parse({
      schemaVersion: 1,
      ...applyInstructorEdits(data.output, cfg.edits),
      glossary: cfg.glossary,
    });
    const caseInput = data.input as CaseInput;

    for (const t of cfg.teams) {
      if (only.size > 0 && !only.has(t.contentFile)) continue;
      const content = await personaliseCaseContent({
        base,
        caseInput,
        // The team label is deliberately left out of the prompt; see
        // LearnerProfileOverride.
        override: { industry: t.industry, role: t.role },
      });
      // Validate before committing so a malformed draft never lands in the seed.
      const parsed = CaseContentSchema.parse(content);
      writeFileSync(join(OUT_DIR, t.contentFile), JSON.stringify(parsed, null, 2) + "\n");
      written.push(t.contentFile);
      const opening = parsed.scenario.slice(0, 90).replace(/\s+/g, " ");
      console.log(`wrote ${t.contentFile}, ${t.industry}: "${opening}..."`);
    }
  }

  // The variant files hold case content and are loaded straight into the seed,
  // so the commit, date and model sit beside them rather than inside them.
  writeFileSync(
    join(OUT_DIR, "provenance.json"),
    JSON.stringify(
      {
        ...resultProvenance(describeGenerationModel()),
        source:
          "demo/sample-outputs, with the instructor edits in scripts/seed-demo.ts applied, personalised per team",
        // Personalisation is not deterministic (temperature 0.5, no seed).
        deterministic: false,
        files: CASES.flatMap((c) => c.teams.map((t) => t.contentFile)),
        rewrittenThisRun: written,
      },
      null,
      2,
    ) + "\n",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
