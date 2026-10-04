import type { DisciplineId, DisciplinePack } from "./types";
import { FINANCE } from "./finance";
import { MARKETING } from "./marketing";
import { SOCIAL_WORK } from "./social-work";

export const DISCIPLINE_PACKS: Record<DisciplineId, DisciplinePack> = {
  finance: FINANCE,
  marketing: MARKETING,
  social_work: SOCIAL_WORK,
};

export const DISCIPLINE_IDS: DisciplineId[] = ["finance", "marketing", "social_work"];

export function getDisciplinePack(id: DisciplineId): DisciplinePack {
  return DISCIPLINE_PACKS[id];
}

// The discipline a case belongs to, for code that is handed only the case
// content (the feedback and hint routes do not send it). The open phase's id
// decides when it is one of a pack's default phases. Otherwise the rubric
// decides, by which pack's template criterion names it uses most, and failing
// that the scenario, by which pack's vocabulary it uses most. Null when none of
// these settles it.
export function inferDisciplineId(input: {
  rubric: string;
  scenario?: string;
  phaseIds?: string[];
}): DisciplineId | null {
  const phaseIds = input.phaseIds ?? [];
  for (const id of DISCIPLINE_IDS) {
    const own = new Set(DISCIPLINE_PACKS[id].defaultPhases.map((p) => p.id));
    if (phaseIds.some((p) => own.has(p))) return id;
  }
  const mostHits = (text: string, terms: (id: DisciplineId) => string[]) => {
    const lower = text.toLowerCase();
    let best: DisciplineId | null = null;
    let bestHits = 0;
    let tie = false;
    for (const id of DISCIPLINE_IDS) {
      const hits = terms(id).filter((t) => t && lower.includes(t)).length;
      if (hits > bestHits) {
        best = id;
        bestHits = hits;
        tie = false;
      } else if (hits === bestHits && hits > 0) {
        tie = true;
      }
    }
    return tie ? null : best;
  };
  const byRubric = mostHits(input.rubric, (id) =>
    DISCIPLINE_PACKS[id].rubricTemplate
      .split("\n")
      .map((line) => line.split("(")[0].trim().toLowerCase()),
  );
  if (byRubric) return byRubric;
  return mostHits(`${input.scenario ?? ""}\n${input.rubric}`, (id) =>
    DISCIPLINE_PACKS[id].vocabulary.map((v) => v.toLowerCase()),
  );
}

export * from "./types";
