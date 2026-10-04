import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import type { EmbeddingModel, LanguageModel } from "ai";

let cached: LanguageModel | null = null;

export function getGenerationModel(): LanguageModel {
  if (cached) return cached;
  // Normalise: tolerate stray quotes/whitespace/case in the env value.
  const provider = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
  const modelOverride = process.env.LLM_GENERATION_MODEL?.trim() || undefined;
  if (provider === "openai") {
    cached = openai(modelOverride ?? "gpt-4o-mini");
  } else if (provider === "anthropic") {
    cached = anthropic(modelOverride ?? "claude-haiku-4-5-20251001");
  } else {
    throw new Error(`Unsupported LLM_PROVIDER: ${JSON.stringify(provider)}`);
  }
  return cached;
}

// Default embedding model for the retrieval corpus. Embeddings always run on
// OpenAI (text-embedding-3-small, 1536 dims) regardless of LLM_PROVIDER, so
// retrieval needs OPENAI_API_KEY even when generation uses Anthropic.
export const EMBEDDING_MODEL_ID =
  process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

let cachedEmbedding: EmbeddingModel<string> | null = null;

export function getEmbeddingModel(): EmbeddingModel<string> {
  if (cachedEmbedding) return cachedEmbedding;
  cachedEmbedding = openai.embedding(EMBEDDING_MODEL_ID);
  return cachedEmbedding;
}

// A human-readable identifier for the configured generation model, e.g.
// "openai:gpt-4o-mini". Recorded with cached contrastive-view results so a row
// read back weeks later says which model produced it.
export function describeGenerationModel(): string {
  const m = getGenerationModel() as unknown as { provider?: string; modelId?: string };
  const provider = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
  return `${m.provider ?? provider}:${m.modelId ?? "unknown"}`;
}
