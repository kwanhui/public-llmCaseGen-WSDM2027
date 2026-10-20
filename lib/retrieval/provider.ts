import type { CaseInput, FewShotExemplar } from "@/lib/disciplines/types";

export interface RetrievalResult {
  groundingText: string;
  exemplars: FewShotExemplar[];
  provenance: string[];
}

// `abortSignal` lets a caller with a time limit stop a call that is taking too
// long, such as the embedding of the brief. A provider that makes no call
// ignores it.
export interface RetrieveOptions {
  abortSignal?: AbortSignal;
}

export interface RetrievalProvider {
  retrieve(input: CaseInput, options?: RetrieveOptions): Promise<RetrievalResult>;
}
