// Retrieval for the demo's PersCase arm. The brief is embedded once, through
// the same retrievePreview the instructor's Retrieval step renders, and the
// notes it selects are handed to generation through a one-shot provider. The
// trace the page shows and the notes the model received are therefore the same
// set, which two separate embedding calls would not guarantee.
import { getRetrievalProvider, promptPackRetrieval } from "@/lib/retrieval";
import {
  RETRIEVAL_MIN_SCORE,
  RETRIEVAL_WEAK_SCORE,
  retrievalResultFromHits,
  retrievePreview,
} from "@/lib/retrieval/embedding-provider";
import { corpusChunkById, isCaseDesignNote } from "@/lib/retrieval/corpus";
import { conceptsWithoutNote } from "@/lib/retrieval/concept-notes";
import type { RetrievalProvider } from "@/lib/retrieval/provider";
import type { CaseInput } from "@/lib/disciplines/types";
import type { RetrievalTrace } from "./contracts";

export class DemoRetrievalError extends Error {}

type RetrievedHit = Awaited<ReturnType<typeof retrievePreview>>["chunks"][number];

export const EXCERPT_CHARS = 140;

// The start of a note's text on one line, for the trace's rows.
export function noteExcerpt(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= EXCERPT_CHARS ? t : `${t.slice(0, EXCERPT_CHARS).trimEnd()}…`;
}

function traceNotes(hits: RetrievedHit[], weakScore: number): RetrievalTrace["notes"] {
  return hits.map((h) => ({
    id: h.chunk.id,
    title: h.chunk.title,
    score: h.score,
    weakMatch: h.score < weakScore,
    caseDesign: isCaseDesignNote(h.chunk.id),
    excerpt: noteExcerpt(h.chunk.text),
  }));
}

function emptyTrace(brief: CaseInput, budget: number) {
  return {
    notes: [],
    leftOut: null,
    // No note was retrieved, so none mentions any concept.
    unmentionedConcepts: [...brief.mustCoverConcepts],
    minScore: RETRIEVAL_MIN_SCORE,
    weakScore: RETRIEVAL_WEAK_SCORE,
    budget,
  };
}

// The retrieval step on its own: one embedding call, no model call. Returns
// the notes as generation would receive them (`hits`, `provider`), the trace
// the page shows, and the provenance that names the notes, which the page
// sends back with the perscase arm (providerFromProvenance).
export async function retrieveForDemo(brief: CaseInput): Promise<{
  provider: RetrievalProvider;
  trace: RetrievalTrace;
  provenance: string[];
}> {
  const budget = Number(process.env.RETRIEVAL_TOP_K ?? 5);
  const empty = emptyTrace(brief, budget);

  const configured = getRetrievalProvider();
  if (configured === promptPackRetrieval) {
    const provenance = (await promptPackRetrieval.retrieve(brief)).provenance;
    return { provider: promptPackRetrieval, trace: { ...empty, status: "retrieval-off" }, provenance };
  }

  const preview = await retrievePreview(brief, budget);
  if (preview.status === "embedding-failed") {
    throw new DemoRetrievalError(preview.error ?? "The embedding call failed.");
  }
  if (preview.status === "corpus-not-embedded") {
    // The embedding provider falls back to the discipline pack on its own and
    // makes no embedding call when the corpus is not embedded.
    const provenance = (await configured.retrieve(brief)).provenance;
    return { provider: configured, trace: { ...empty, status: "corpus-not-embedded" }, provenance };
  }

  const hits = preview.chunks;
  const rejected = preview.firstRejected;
  const trace: RetrievalTrace = {
    notes: traceNotes(hits, preview.weakScore),
    leftOut: rejected
      ? {
          id: rejected.chunk.id,
          title: rejected.chunk.title,
          score: rejected.score,
          rule: rejected.reason,
        }
      : null,
    unmentionedConcepts: conceptsWithoutNote(brief.mustCoverConcepts, hits),
    status: "ok",
    minScore: preview.minScore,
    weakScore: preview.weakScore,
    budget: preview.budget,
  };
  const provider: RetrievalProvider = {
    retrieve: async (input) => retrievalResultFromHits(input, hits),
  };
  return { provider, trace, provenance: retrievalResultFromHits(brief, hits).provenance };
}

// Provenance entries of a retrieved note look like `corpus:fin-ddm (0.512)`.
const CORPUS_ENTRY = /^corpus:(\S+) \((-?\d+(?:\.\d+)?)\)$/;

// The notes a provenance list names, rebuilt without an embedding call, so
// that the perscase arm generates from exactly the notes the retrieve arm
// showed. Notes of another discipline, unknown ids and anything past the
// budget are dropped. A list with no note (retrieval off, or the corpus not
// embedded) gives the discipline pack alone, as retrieval would have. The
// trace is rebuilt from the same notes; it has no left-out note, which only
// the retrieve arm knows, so the page keeps the trace that arm returned.
export function providerFromProvenance(
  brief: CaseInput,
  provenance: string[],
): { provider: RetrievalProvider; trace: RetrievalTrace } {
  const budget = Number(process.env.RETRIEVAL_TOP_K ?? 5);
  const hits: RetrievedHit[] = [];
  for (const entry of provenance) {
    const m = entry.match(CORPUS_ENTRY);
    if (!m) continue;
    const chunk = corpusChunkById(m[1]);
    if (!chunk || chunk.discipline !== brief.discipline) continue;
    if (hits.some((h) => h.chunk.id === chunk.id)) continue;
    hits.push({ chunk, score: Number(m[2]) });
    if (hits.length >= budget) break;
  }
  const empty = emptyTrace(brief, budget);
  if (hits.length === 0) {
    const off = getRetrievalProvider() === promptPackRetrieval;
    return {
      provider: promptPackRetrieval,
      trace: { ...empty, status: off ? "retrieval-off" : "corpus-not-embedded" },
    };
  }
  return {
    provider: { retrieve: async (input) => retrievalResultFromHits(input, hits) },
    trace: {
      ...empty,
      notes: traceNotes(hits, RETRIEVAL_WEAK_SCORE),
      unmentionedConcepts: conceptsWithoutNote(brief.mustCoverConcepts, hits),
      status: "ok",
    },
  };
}
