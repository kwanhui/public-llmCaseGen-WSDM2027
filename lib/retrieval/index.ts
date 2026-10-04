import type { RetrievalProvider } from "./provider";
import { promptPackRetrieval } from "./prompt-pack-provider";
import { embeddingRetrieval } from "./embedding-provider";

export type { RetrievalProvider, RetrievalResult } from "./provider";
export { promptPackRetrieval } from "./prompt-pack-provider";
export { embeddingRetrieval, buildQueryText, topK } from "./embedding-provider";

// Provider selection. Default is dense embedding retrieval over the curated
// discipline corpus; set RETRIEVAL_PROVIDER=prompt-pack to disable retrieval
// (pack-only grounding). The embedding provider itself degrades to pack-only
// grounding when the corpus has not been embedded.
export function getRetrievalProvider(): RetrievalProvider {
  const choice = process.env.RETRIEVAL_PROVIDER ?? "embedding";
  if (choice === "prompt-pack") return promptPackRetrieval;
  return embeddingRetrieval;
}
