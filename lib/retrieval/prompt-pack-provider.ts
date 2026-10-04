import { getDisciplinePack } from "@/lib/disciplines";
import type { CaseInput, DisciplinePack, Difficulty } from "@/lib/disciplines/types";
import type { RetrievalProvider, RetrievalResult } from "./provider";

// Shared builder: the discipline-pack portion of the grounding text. The
// embedding provider appends retrieved passages after this block.
export function buildPackGrounding(pack: DisciplinePack, difficulty: Difficulty): string {
  return [
    `# Discipline: ${pack.label}`,
    ``,
    `## Style notes`,
    ...pack.styleNotes.map((s) => `- ${s}`),
    ``,
    `## Discipline vocabulary (use where natural)`,
    pack.vocabulary.join(", "),
    ``,
    `## Difficulty calibration for "${difficulty}"`,
    pack.difficultyHints[difficulty],
    ``,
    `## Rubric template`,
    pack.rubricTemplate,
  ].join("\n");
}

// Baseline retrieval: returns the discipline pack as grounding with no
// similarity search. Kept as a fallback (RETRIEVAL_PROVIDER=prompt-pack) and as
// the degradation path when the corpus has not been embedded yet.
export class PromptPackRetrievalProvider implements RetrievalProvider {
  async retrieve(input: CaseInput): Promise<RetrievalResult> {
    const pack = getDisciplinePack(input.discipline);
    return {
      groundingText: buildPackGrounding(pack, input.difficulty),
      exemplars: pack.fewShots,
      provenance: [`discipline-pack:${pack.id}`],
    };
  }
}

export const promptPackRetrieval = new PromptPackRetrievalProvider();
