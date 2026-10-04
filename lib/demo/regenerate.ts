// The instructor's remedy for a flagged concept, as the public demo runs it:
// which section to regenerate, and the editor's note sent with it. Pure: no
// React, no model call, no network.
import type { CaseSection, CaseTextFields } from "@/lib/generation/schema";

export const SECTION_NAMES: Record<CaseSection, string> = {
  scenario: "scenario",
  // Regenerating the questions also rewrites their answers
  // (lib/generation/regenerate-section.ts), so the name says both.
  discussionQuestions: "discussion questions and model answers",
  modelAnswers: "model answers",
  rubric: "rubric",
};

// Words too common to show that a concept is touched on.
const STOPWORDS = new Set(["and", "the", "for", "with", "from", "into", "of", "to", "in", "on", "vs", "versus"]);

// The start of a word, so that "discount" also finds "discounted" and
// "discounting". Shorter words are compared whole.
function stemOf(word: string): string {
  return word.length > 5 ? word.slice(0, 5) : word;
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * True when the scenario touches on the concept at all: at least one of its
 * words of four letters or more (or the start of one) occurs in the scenario.
 * Looser than the must-cover check, which needs the whole concept in one
 * sentence; a concept the check flags can still be touched on here.
 */
export function scenarioTouchesOn(concept: string, scenario: string): boolean {
  const stems = new Set(wordsOf(scenario).map(stemOf));
  return wordsOf(concept)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .some((w) => stems.has(stemOf(w)));
}

/**
 * The section to regenerate for a list of flagged concepts. The rule: the
 * discussion questions, which are regenerated together with their model
 * answers, since answers alone cannot bring in a concept that no question asks
 * about. The scenario is regenerated instead when some flagged concept is
 * absent from it altogether (not one of its words occurs there), since
 * questions cannot rest on a concept the case itself never raises.
 */
export function sectionToRegenerate(content: CaseTextFields, missing: string[]): CaseSection {
  return missing.some((c) => !scenarioTouchesOn(c, content.scenario))
    ? "scenario"
    : "discussionQuestions";
}

export function regenerateEditorNote(missing: string[]): string {
  return `Work the following must-cover concepts into this section: ${missing.join(", ")}.`;
}
