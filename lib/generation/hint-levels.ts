// The three rungs of the hint ladder, by name and rule. The rules are the ones
// the hint prompt states (lib/generation/hint.ts builds its ladder text from
// this list), and the names are the ones the student page and the demo show.
//
// The ladder follows the hint sequences of tutoring systems: a first hint that
// points to where to look, a second that says what to weigh, and a third that
// names the concept and the next step. Those systems usually end on a hint that
// gives the answer away; PersCase leaves that rung out, since a student can
// click through to it without doing the work.
//
// Kept in a module of its own, with no imports, so that the client pages can
// read the names without pulling the model client into the browser bundle.
export type HintLevelNumber = 1 | 2 | 3;

export interface HintLevel {
  level: HintLevelNumber;
  name: string;
  rule: string;
}

export const HINT_LEVELS: readonly HintLevel[] = [
  {
    level: 1,
    name: "Where to look",
    rule: "names a place in the case to look (a person's own words, a figure the scenario gives, a constraint someone states) or a consideration found there. It never uses any of the terms on the do-not-use list below, and it never names the principle, framework, concept or figure the model answer rests on.",
  },
  {
    level: 2,
    name: "What to weigh",
    rule: "may narrow: it names the specific tension, relationship or quantity the student has not used yet, and it still describes rather than names the terms on the do-not-use list.",
  },
  {
    level: 3,
    name: "The concept and the next step",
    rule: "may name the concept itself, and the concrete next step to take with it, still without doing the step or stating the answer.",
  },
];

// The one-line explanation shown once above the first hint.
export const HINT_LADDER_NOTE =
  "Hints go from where to look, to what to weigh, to the concept and the next step; none states the answer.";

// The level of the nth hint (1-based), held at the last rung.
export function hintLevel(n: number): HintLevel {
  const i = Math.min(Math.max(Math.trunc(n), 1), HINT_LEVELS.length) - 1;
  return HINT_LEVELS[i];
}

// "Hint 2 of 3: what to weigh", with the level name in lower case after the
// colon.
export function hintHeading(n: number, total: number, verb = "Hint"): string {
  const name = hintLevel(n).name;
  return `${verb} ${n} of ${total}: ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}
