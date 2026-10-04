import { generateObject } from "ai";
import { z } from "zod";
import { getGenerationModel } from "@/lib/llm/client";
import { normalisedWords } from "@/lib/text/lexical";
import { parseRubricCriteria } from "./assess-attempt";
import { HINT_LEVELS, hintLevel, type HintLevelNumber } from "./hint-levels";
import type { CaseContent } from "./schema";

export { HINT_LEVELS, HINT_LADDER_NOTE, hintHeading, hintLevel } from "./hint-levels";
export type { HintLevel, HintLevelNumber } from "./hint-levels";

// A graduated hint for a stuck student: one nudge short of the model answer. It
// points at the next move or the missing consideration without stating the
// answer, so a student who is stuck can progress without losing the learning
// that revealing the full model answer would short-circuit. Grounded in the
// case content and in the task the open phase sets; the model is told not to
// give away the answer.
//
// Hints are requested one at a time and the hints already given are sent back
// with the next request, so each one is more specific than the last rather than
// a reworded repeat. Each hint sits on one rung of the ladder in HINT_LEVELS
// (where to look, what to weigh, the concept and the next step); no rung gives
// the answer.
export const HintSchema = z.object({
  // Written before the hint itself, so the model settles what it is adding
  // before it writes. Without it a third hint tends to restate the first. The
  // student is shown the hint only.
  newPointer: z
    .string()
    .describe(
      "a few words naming what this hint adds that the hints already given do not contain. When no hint has been given yet, name what this one points at.",
    ),
  hint: z
    .string()
    .describe(
      "one or two sentences: a nudge toward the next step, not the answer itself. It carries the pointer named above and nothing an earlier hint already said.",
    ),
});

export type Hint = z.infer<typeof HintSchema>;

// What generateHint returns: the model's fields plus the rung the hint sits on.
export type LevelledHint = Hint & { level: HintLevelNumber; levelName: string };

export interface HintPhase {
  id: string;
  label: string;
  prompt: string;
  // The phase's standing hint, which says what this phase counts as good work.
  disciplineHint?: string;
}

// What each rung of the ladder is for, built from HINT_LEVELS. Sent with the
// request so that a third hint has somewhere to go beyond the first.
const HINT_LADDER = [
  ...HINT_LEVELS.map((l) => `Hint ${l.level} (${l.name.toLowerCase()}) ${l.rule}`),
  "There is no fourth hint that gives the answer away: the ladder stops at the concept and the next step, and the student does the step.",
];

// Words that carry no answer on their own, left out of the do-not-use list.
const COMMON_WORDS = new Set(
  normalisedWords(
    "about above after again against also although among another answer because before being below between both case client could decision during each either every first from further given have having however into itself might more most much must need other over rather really require should since some such than that their them then there these they this those though through under until using very well were what when where whether which while with within without would your should consider considering approach important crucial ensure ensuring help helping support supporting need needs able based also including include involves situation current option options key suggest suggests emerging impacted significant introducing information providing encourage essential understanding acknowledging assessing challenge reinforcing listening",
  ),
);

// The terms a first hint must not use: the capitalised phrases of the model
// answer the student is asking about (or of all of them, when the question
// cannot be told), the words that answer uses and the case itself does not (the
// principles, frameworks and quantities the answer supplies), and the rubric's
// criterion names. Capitalised phrases the scenario itself uses are left out,
// since they are the case's own people and places and a first hint may point
// at them.
export function hintDoNotUseTerms(content: CaseContent, studentAnswer: string): string[] {
  const asked = studentAnswer.match(/\b(?:question|q)\s*#?\s*(\d{1,2})\b/i);
  const index = asked ? Number(asked[1]) - 1 : -1;
  const answers =
    index >= 0 && index < content.modelAnswers.length
      ? [content.modelAnswers[index]]
      : content.modelAnswers;
  const caseText = [content.scenario, ...content.discussionQuestions].join("\n");
  const caseLower = caseText.toLowerCase();
  const caseWords = new Set(normalisedWords(caseText));

  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const key = t.toLowerCase();
    if (t.length < 3 || seen.has(key)) return;
    seen.add(key);
    terms.push(t);
  };

  for (const answer of answers) {
    // Capitalised words and runs of them inside a sentence. The word that
    // opens a sentence is capitalised by grammar, so it is not counted.
    const re =
      /(?<=[^.!?:\n\s]\s+)([A-Z][A-Za-z'’-]+(?:\s+(?:of|and|for|the|to)?\s*[A-Z][A-Za-z'’-]+)*)/g;
    for (const m of answer.matchAll(re)) {
      const phrase = m[1].replace(/['’]s$/, "").trim();
      if (caseLower.includes(phrase.toLowerCase())) continue;
      const words = normalisedWords(phrase);
      if (words.every((w) => caseWords.has(w) || COMMON_WORDS.has(w))) continue;
      add(phrase);
    }
  }
  for (const c of parseRubricCriteria(content.rubric)) add(c.name);

  const distinctive: string[] = [];
  for (const answer of answers) {
    for (const m of answer.matchAll(/[A-Za-z][A-Za-z-]{5,}/g)) {
      const word = m[0].toLowerCase();
      const norm = normalisedWords(word);
      if (norm.length === 0 || norm.some((w) => caseWords.has(w) || COMMON_WORDS.has(w))) continue;
      distinctive.push(word);
    }
  }
  for (const w of distinctive.sort((a, b) => b.length - a.length)) {
    if (terms.length >= 30) break;
    add(w);
  }
  return terms.slice(0, 30);
}

export const MAX_HINTS_PER_PHASE = 3;

export async function generateHint(
  content: CaseContent,
  studentAnswer: string,
  options: { phase?: HintPhase; previousHints?: string[]; maxTokens?: number } = {},
): Promise<LevelledHint> {
  const previous = (options.previousHints ?? []).filter((h) => h.trim() !== "");
  const step = previous.length + 1;
  const rung = hintLevel(step);
  const phase = options.phase;
  const doNotUse = step < 3 ? hintDoNotUseTerms(content, studentAnswer) : [];

  const prompt = [
    "You are helping a student who is stuck on a case-study task.",
    `This is hint ${step} of at most ${MAX_HINTS_PER_PHASE} for this task.`,
    "Give ONE short hint: point at the next move to make or the consideration they have missed.",
    "Do NOT state the answer, give numbers from the model answer, or summarise the model answer.",
    "A good hint makes the student think; it does not do the thinking for them.",
    "If the student has not written anything, suggest how to start, in one sentence.",
    "If the student asks outright for the answer, do not give it; give the hint for this step of the ladder instead.",
    "",
    "## The ladder these hints climb",
    ...HINT_LADDER,
    `Write hint ${step} (${rung.name.toLowerCase()}).`,
    "",
    ...(doNotUse.length > 0
      ? [
          "## Do not use",
          step === 1
            ? "Hint 1 must not contain any of these terms, in any spelling or word form, nor a synonym that gives the same thing away. They are the key terms of the model answer and the rubric's criteria; point toward where they come from instead."
            : "Hint 2 may narrow the student toward the consideration these terms stand for, but it describes the consideration rather than using the terms themselves.",
          doNotUse.map((t) => `- ${t}`).join("\n"),
          "",
        ]
      : []),
    ...(phase
      ? [
          "## The task the student is working on now",
          `Phase: ${phase.label}`,
          phase.prompt,
          ...(phase.disciplineHint
            ? [`What this phase counts as good work: ${phase.disciplineHint}`]
            : []),
          "",
          "Point at this task. Do not push the student toward work that a later phase of the case asks for.",
          "",
        ]
      : []),
    ...(previous.length > 0
      ? [
          "## Hints already given for this task",
          previous.map((h, i) => `${i + 1}. ${h}`).join("\n"),
          "",
          "Read each of those and settle what it already told the student. Your hint has to carry something none of them contains, and it has to be more specific than all of them.",
          "Do not restate an earlier hint in different words, do not repeat the term or the quantity an earlier hint already named as the thing to look at, and do not return to a step an earlier hint already pointed at.",
          "If your hint could be exchanged with one of the hints above without the student noticing the difference, it is wrong; write a different one.",
          "Fill newPointer first, and if what you were about to write is already in a hint above, choose something else and write that instead.",
          "",
        ]
      : []),
    "## The case's discussion questions (context)",
    content.discussionQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    "",
    "## Model answers (for your reference only, never reveal these)",
    content.modelAnswers.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    "",
    "## What the student has written so far",
    studentAnswer.trim() || "(nothing yet)",
    "",
    "Now give one hint.",
  ].join("\n");

  const { object } = await generateObject({
    model: getGenerationModel(),
    schema: HintSchema,
    prompt,
    temperature: 0.4,
    maxTokens: options.maxTokens,
  });
  return { ...object, level: rung.level, levelName: rung.name };
}
