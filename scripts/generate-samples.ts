// Generate one case for each of the three demo sample inputs, with no
// database involved. Run: pnpm tsx scripts/generate-samples.ts
// Needs OPENAI_API_KEY (and a built corpus: pnpm embed-corpus).
//
// Writes demo/sample-outputs/<discipline>.json, which the seed script
// loads. Also prints the retrieval provenance (which corpus notes
// were retrieved, with scores).

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generateCase } from "../lib/generation/generate-case";
import { describeGenerationModel } from "../lib/llm/client";
import type { CaseInput } from "../lib/disciplines/types";
import { resultProvenance } from "./result-provenance";

loadEnv({ path: ".env.local" });
loadEnv();

const IN_DIR = join(process.cwd(), "demo/sample-inputs");
const OUT_DIR = join(process.cwd(), "demo/sample-outputs");

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set (check .env.local). Aborting.");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(IN_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const input = JSON.parse(readFileSync(join(IN_DIR, file), "utf8")) as CaseInput;
    console.log(`\n=== ${file} (${input.discipline}) ===`);
    const t0 = Date.now();
    const { output, provenance } = await generateCase(input);
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`generated in ${seconds}s`);
    console.log("retrieval provenance:");
    for (const p of provenance) console.log(`  - ${p}`);

    const record = {
      ...resultProvenance(describeGenerationModel()),
      model: process.env.LLM_GENERATION_MODEL ?? "gpt-4o-mini",
      embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
      // Generation is not deterministic (temperature 0.8, no seed): re-running
      // this script overwrites the committed sample with a different case.
      deterministic: false,
      input,
      provenance,
      output,
    };
    const outPath = join(OUT_DIR, file);
    writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
    console.log(`wrote ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
