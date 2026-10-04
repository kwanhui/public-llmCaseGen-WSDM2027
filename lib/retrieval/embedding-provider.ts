import { embed } from "ai";
import { getEmbeddingModel, EMBEDDING_MODEL_ID } from "@/lib/llm/client";
import { getDisciplinePack } from "@/lib/disciplines";
import type { CaseInput } from "@/lib/disciplines/types";
import { corpusForDiscipline, isCaseDesignNote, type CorpusChunk } from "./corpus";
import embeddingStore from "./corpus/embeddings.json";
import { buildPackGrounding } from "./prompt-pack-provider";
import type { RetrievalProvider, RetrievalResult } from "./provider";

type EmbeddingStore = {
  model: string;
  dimensions: number;
  generatedAt: string | null;
  vectors: Record<string, number[]>;
};

const STORE = embeddingStore as EmbeddingStore;

export interface RetrievedChunk {
  chunk: CorpusChunk;
  score: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// The text we embed to find relevant passages: the case specification, not the
// generated case (which does not exist yet at retrieval time).
export function buildQueryText(input: CaseInput): string {
  return [
    `Discipline: ${getDisciplinePack(input.discipline).label}`,
    `Learning objective: ${input.learningObjective}`,
    `Difficulty: ${input.difficulty}`,
    `Must-cover concepts: ${input.mustCoverConcepts.join(", ")}`,
    `Learner context: ${input.targetLearnerProfile.industry}, ${input.targetLearnerProfile.role}`,
  ].join("\n");
}

// Only passages at least this similar to the query are eligible, so a case
// spec that matches nothing well does not drag in irrelevant grounding.
export const RETRIEVAL_MIN_SCORE = Number(process.env.RETRIEVAL_MIN_SCORE ?? 0.25);
// A passage can clear the threshold and still be a thin match. The retrieval
// trace marks anything below this as a weak match so the instructor does not
// read a low-scoring hit as a good one. It is derived from the threshold, so
// the two move together if the threshold is retuned; at the default threshold
// of 0.25 the weak-match line is 0.35.
export const RETRIEVAL_WEAK_SCORE = RETRIEVAL_MIN_SCORE * 1.4;
// At most this many case-design (pedagogy) notes in the grounding; the rest of
// the budget goes to domain-concept passages, so retrieval stays domain-led
// rather than returning a near-uniform slice of the corpus.
const MAX_PEDAGOGY = 1;

// Which rule kept the best-scoring note out. The three are separate decisions,
// and the instructor is shown the one that applied.
export type RejectionReason = "below-threshold" | "over-budget" | "case-design-cap";

export type RejectedChunk = RetrievedChunk & { reason: RejectionReason };

export interface TopKResult {
  hits: RetrievedChunk[];
  // Every note of the discipline that was not taken, best score first, each
  // with the rule that left it out. The trace reads the first of these, and
  // looks down the list for a note that mentions a must-cover concept none of
  // the retrieved notes mentions.
  leftOut: RejectedChunk[];
  // The best-scoring note that was left out, with the rule that rejected it.
  // The trace shows it so that the instructor can see where the cut-off fell.
  firstRejected: RejectedChunk | null;
  // The best-scoring domain-concept passage that was eligible and still missed
  // the budget. When the cap rejected the top candidate, this is the note the
  // budget rejected, so both rules can be read at once. Null when the budget
  // rejected nothing.
  firstOverBudget: RetrievedChunk | null;
}

export function rankAll(
  queryVector: number[],
  discipline: CaseInput["discipline"],
): RetrievedChunk[] {
  return corpusForDiscipline(discipline)
    .map((chunk) => {
      const vec = STORE.vectors[chunk.id];
      // Skip a chunk whose stored vector is missing or a different dimension
      // than the query (e.g. EMBEDDING_MODEL changed without re-embedding):
      // scoring across mismatched dimensions would produce meaningless ranks.
      if (!vec || vec.length !== queryVector.length) return null;
      return { chunk, score: cosineSimilarity(queryVector, vec) };
    })
    .filter((x): x is RetrievedChunk => x !== null)
    .sort((a, b) => b.score - a.score);
}

export function selectChunks(
  queryVector: number[],
  discipline: CaseInput["discipline"],
  k: number,
): TopKResult {
  const all = rankAll(queryVector, discipline);
  const ranked = all.filter((r) => r.score >= RETRIEVAL_MIN_SCORE);

  // Domain concepts first; allow at most MAX_PEDAGOGY case-design notes.
  const concepts = ranked.filter((r) => !isCaseDesignNote(r.chunk.id));
  const pedagogy = ranked.filter((r) => isCaseDesignNote(r.chunk.id)).slice(0, MAX_PEDAGOGY);
  const eligible = [...concepts, ...pedagogy].sort((a, b) => b.score - a.score);
  const hits = eligible.slice(0, k);

  const kept = new Set(hits.map((h) => h.chunk.id));
  const eligibleIds = new Set(eligible.map((r) => r.chunk.id));
  // Which rule rejected it: the threshold if it never cleared the floor, the
  // cap if it cleared the floor but was a case-design note beyond the one slot
  // such notes may take, and the budget otherwise.
  const reasonFor = (r: RetrievedChunk): RejectionReason => {
    if (r.score < RETRIEVAL_MIN_SCORE) return "below-threshold";
    if (!eligibleIds.has(r.chunk.id)) return "case-design-cap";
    return "over-budget";
  };
  const leftOut: RejectedChunk[] = all
    .filter((r) => !kept.has(r.chunk.id))
    .map((r) => ({ ...r, reason: reasonFor(r) }));
  const firstRejected = leftOut[0] ?? null;
  const firstOverBudget =
    eligible.find((r) => !kept.has(r.chunk.id) && !isCaseDesignNote(r.chunk.id)) ?? null;

  return { hits, leftOut, firstRejected, firstOverBudget };
}

export function topK(
  queryVector: number[],
  discipline: CaseInput["discipline"],
  k: number,
): RetrievedChunk[] {
  return selectChunks(queryVector, discipline, k).hits;
}

export function isCorpusEmbedded(): boolean {
  return Object.keys(STORE.vectors).length > 0;
}

// Why a preview came back with no notes. The two failures need different
// remedies: an unembedded corpus is fixed by running the embedding script, a
// failed call by fixing the key or the network.
export type RetrievalStatus = "ok" | "corpus-not-embedded" | "embedding-failed";

export interface RetrievalPreview {
  chunks: RetrievedChunk[];
  embedded: boolean;
  // Which of the two failures happened, when `embedded` is false.
  status: RetrievalStatus;
  // The provider's own message for a failed embedding call, so the instructor
  // can tell an authentication error from a network one. Null otherwise.
  error: string | null;
  // What the retrieval trace shows: the text that was embedded, the threshold
  // it was scored against, the budget, and the best note that was left out.
  queryText: string;
  minScore: number;
  weakScore: number;
  budget: number;
  firstRejected: TopKResult["firstRejected"];
  firstOverBudget: TopKResult["firstOverBudget"];
  // Every note that was not taken, with the rule that left it out, so the trace
  // can say what happened to a note a must-cover concept needed.
  leftOut: TopKResult["leftOut"];
  // The lowest score among the notes that were taken. The trace states it
  // rather than asserting that a rejected note scored above or below them.
  lowestTakenScore: number | null;
}

// Structured retrieval for the authoring UI: returns the ranked chunks (with
// scores) so the instructor can see exactly what grounds the next generation.
// Degrades to an empty, embedded:false result when the corpus has not been
// embedded or the embedding call fails (e.g. missing key) rather than throwing.
export async function retrievePreview(
  input: CaseInput,
  k = Number(process.env.RETRIEVAL_TOP_K ?? 5),
): Promise<RetrievalPreview> {
  const queryText = buildQueryText(input);
  const base = {
    queryText,
    minScore: RETRIEVAL_MIN_SCORE,
    weakScore: RETRIEVAL_WEAK_SCORE,
    budget: k,
    firstRejected: null,
    firstOverBudget: null,
    leftOut: [],
    lowestTakenScore: null,
    error: null,
  };
  if (!isCorpusEmbedded())
    return { chunks: [], embedded: false, status: "corpus-not-embedded", ...base };
  try {
    const { embedding } = await embed({
      model: getEmbeddingModel(),
      value: queryText,
    });
    const { hits, leftOut, firstRejected, firstOverBudget } = selectChunks(
      embedding,
      input.discipline,
      k,
    );
    return {
      chunks: hits,
      embedded: true,
      status: "ok",
      ...base,
      firstRejected,
      firstOverBudget,
      leftOut,
      lowestTakenScore: hits.length > 0 ? hits[hits.length - 1].score : null,
    };
  } catch (err) {
    return {
      chunks: [],
      embedded: false,
      status: "embedding-failed",
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Dense-retrieval grounding: embeds the case spec, ranks the discipline corpus
// by cosine similarity, and conditions generation on the top-k passages. Falls
// back to pack-only grounding if the corpus has not been embedded.
export class EmbeddingRetrievalProvider implements RetrievalProvider {
  constructor(private readonly k = Number(process.env.RETRIEVAL_TOP_K ?? 5)) {}

  async retrieve(input: CaseInput): Promise<RetrievalResult> {
    const pack = getDisciplinePack(input.discipline);
    const packGrounding = buildPackGrounding(pack, input.difficulty);

    if (!isCorpusEmbedded()) {
      return {
        groundingText: packGrounding,
        exemplars: pack.fewShots,
        provenance: [`discipline-pack:${pack.id}`, "retrieval:corpus-not-embedded"],
      };
    }

    const { embedding } = await embed({
      model: getEmbeddingModel(),
      value: buildQueryText(input),
    });
    const hits = topK(embedding, input.discipline, this.k);
    return retrievalResultFromHits(input, hits);
  }
}

// The grounding text and provenance for a set of retrieved notes. Shared with
// the public demo route, which ranks the notes once through retrievePreview and
// hands the same hits to generation, so the trace it shows and the notes the
// model received cannot differ.
export function retrievalResultFromHits(
  input: CaseInput,
  hits: RetrievedChunk[],
): RetrievalResult {
  const pack = getDisciplinePack(input.discipline);
  const packGrounding = buildPackGrounding(pack, input.difficulty);
  const retrievedBlock = [
    ``,
    `## Retrieved discipline references (most relevant to this case)`,
    `Use these to keep the case technically accurate; do not quote them verbatim.`,
    ...hits.map((h) => `### ${h.chunk.title}\n${h.chunk.text}`),
  ].join("\n");

  return {
    groundingText: packGrounding + "\n" + retrievedBlock,
    exemplars: pack.fewShots,
    provenance: [
      `embedding:${EMBEDDING_MODEL_ID}`,
      ...hits.map((h) => `corpus:${h.chunk.id} (${h.score.toFixed(3)})`),
    ],
  };
}

export const embeddingRetrieval = new EmbeddingRetrievalProvider();
