import type { CaseInput, FewShotExemplar } from "@/lib/disciplines/types";

export interface RetrievalResult {
  groundingText: string;
  exemplars: FewShotExemplar[];
  provenance: string[];
}

export interface RetrievalProvider {
  retrieve(input: CaseInput): Promise<RetrievalResult>;
}
