import type { DisciplineId } from "@/lib/disciplines/types";
import type { CorpusChunk } from "./types";
import { FINANCE_CORPUS } from "./finance";
import { MARKETING_CORPUS } from "./marketing";
import { SOCIAL_WORK_CORPUS } from "./social-work";

export type { CorpusChunk } from "./types";

export const CORPUS: CorpusChunk[] = [
  ...FINANCE_CORPUS,
  ...MARKETING_CORPUS,
  ...SOCIAL_WORK_CORPUS,
];

export function corpusForDiscipline(discipline: DisciplineId): CorpusChunk[] {
  return CORPUS.filter((c) => c.discipline === discipline);
}

export function corpusChunkById(id: string): CorpusChunk | undefined {
  return CORPUS.find((c) => c.id === id);
}

// Case-design notes describe how to build a teaching case; the rest describe
// the domain. Retrieval caps how many case-design notes can take a slot, and
// the interface tags them, so the id convention lives here and is read by both.
export function isCaseDesignNote(id: string): boolean {
  return id.includes("pedagogy");
}
