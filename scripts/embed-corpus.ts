// Embed the discipline corpus and write the committed vector store.
// Run: pnpm embed-corpus   (needs OPENAI_API_KEY in .env.local)
//
// Output: lib/retrieval/corpus/embeddings.json, one vector per corpus chunk,
// keyed by chunk id. Committed so retrieval works on a fresh checkout without
// re-embedding. Re-run after editing the corpus to keep vectors in sync.

import { config as loadEnv } from "dotenv";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS } from "../lib/retrieval/corpus";

loadEnv({ path: ".env.local" });
loadEnv(); // fall back to .env

const MODEL_ID = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const OUT_PATH = join(process.cwd(), "lib/retrieval/corpus/embeddings.json");

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set (check .env.local). Aborting.");
    process.exit(1);
  }

  console.log(`Embedding ${CORPUS.length} corpus chunks with ${MODEL_ID}...`);
  // We embed "title. text" so the short title contributes to the vector.
  const values = CORPUS.map((c) => `${c.title}. ${c.text}`);

  const { embeddings } = await embedMany({
    model: openai.embedding(MODEL_ID),
    values,
  });

  const vectors: Record<string, number[]> = {};
  CORPUS.forEach((c, i) => {
    vectors[c.id] = embeddings[i];
  });

  const store = {
    model: MODEL_ID,
    dimensions: embeddings[0]?.length ?? 0,
    generatedAt: new Date().toISOString(),
    vectors,
  };

  writeFileSync(OUT_PATH, JSON.stringify(store, null, 0) + "\n");
  console.log(
    `Wrote ${Object.keys(vectors).length} vectors (${store.dimensions} dims) to ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
