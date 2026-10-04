import type { DisciplineId } from "@/lib/disciplines/types";

// A single retrievable passage in PersCase's discipline corpus.
//
// These passages are concise, original domain notes authored for PersCase.
// They are NOT excerpts from copyrighted textbooks or papers; `tags` and `id`
// carry the provenance shown to the instructor at authoring time. Each note is
// a self-contained explanation of one concept or pedagogical move so that
// cosine retrieval can pull the few passages most relevant to a case spec.
export interface CorpusChunk {
  id: string;
  discipline: DisciplineId;
  title: string;
  text: string;
  tags: string[];
}
