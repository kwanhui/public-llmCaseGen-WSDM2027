// What differs between the two demo columns at one step, as short cards.
//
// Exports (kept stable for components/demo/demo-client.tsx):
//   computeDifferences(input: DifferencesInput): DifferenceCard[]
//   type DifferencesInput, type DifferenceCard, type DifferenceStep
//   caseTextOf(content | text): string   the text a structured case reads as
//   draftTextOf(draft result): string     the same, for a generate response
//   stepOfCards(cards): DifferenceStep | null   which step a card list is for
//
// Each card is one sentence that names both columns and says what each did.
// The sentences report counts and facts from the responses; they never rate a
// column. Cards are returned only when both columns have a result for the step.
// Pure: no React, no model call, no network.
import type {
  DemoGenerateResponse,
  DemoPersonaliseResponse,
  DemoStudentResponse,
  RetrievalTrace,
} from "./contracts";
import type { ArmSignals, SectionPresence } from "@/lib/generation/compare";
import type { CaseSection, CaseTextFields } from "@/lib/generation/schema";
import type { RejectionReason } from "@/lib/retrieval/embedding-provider";
import { compareFigures, extractFigures, figureKey } from "@/lib/text/figures";
import { SECTION_NAMES } from "./regenerate";

export type DifferenceStep = "retrieval" | "draft" | "regenerate" | "variant" | "student";

export interface DifferenceCard {
  id: string;
  title: string;
  sentence: string;
  detail?: string[];
}

type GenerateResult = Exclude<DemoGenerateResponse, { arm: "signals" | "retrieve" | "budget" | "regenerate" }>;

// Either the route's response or the column state object that wraps it as
// `result` (DraftData, VariantData, StudentData in components/demo/column.tsx).
type Wrapped<T> = T | { result: T };

interface DifferencesCommon {
  baseline: "plain" | "structured";
  // The text of each column's own draft, for the variant step's figure count.
  // draftTextOf(draft.result) gives it.
  leftDraftText?: string;
  rightDraftText?: string;
  // The case the student is working on (its scenario, or the whole case), for
  // the student step's check for figures copied from the case.
  caseText?: string;
  // The message the student sent, for the feedback card's check for a reply
  // that rewrites the student's answer.
  studentMessage?: string;
}

export type DifferencesInput =
  // The retrieval step has one column only: the standard LLM retrieves
  // nothing, so the card needs the PersCase trace alone.
  | ({
      step: "retrieval";
      trace: RetrievalTrace | null;
    } & Partial<DifferencesCommon>)
  | ({
      step: "draft";
      left: Wrapped<GenerateResult> | null;
      right: Wrapped<GenerateResult> | null;
    } & DifferencesCommon)
  // The regeneration step has one column only as well: the standard LLM has
  // no check and so nothing to regenerate. `before` is the PersCase draft's
  // readings at generation, `after` its readings once the section was
  // regenerated.
  | ({
      step: "regenerate";
      section: CaseSection;
      before: ArmSignals;
      after: ArmSignals;
      // How many regenerations the draft has had; 1 when left out.
      regenerations?: number;
    } & Partial<DifferencesCommon>)
  | ({
      step: "variant";
      left: Wrapped<DemoPersonaliseResponse> | null;
      right: Wrapped<DemoPersonaliseResponse> | null;
    } & DifferencesCommon)
  | ({
      step: "student";
      left: Wrapped<DemoStudentResponse> | null;
      right: Wrapped<DemoStudentResponse> | null;
    } & DifferencesCommon);

const LEFT = "Standard LLM";

function unwrap<T extends object>(x: Wrapped<T> | null): T | null {
  if (!x) return null;
  return "result" in x ? (x as { result: T }).result : (x as T);
}

export function caseTextOf(content: CaseTextFields | string): string {
  if (typeof content === "string") return content;
  return [
    content.scenario,
    content.discussionQuestions.join("\n\n"),
    content.modelAnswers.join("\n\n"),
    content.rubric,
  ]
    .filter((s) => s.trim() !== "")
    .join("\n\n");
}

export function draftTextOf(result: GenerateResult): string {
  return result.kind === "text" ? result.text : caseTextOf(result.content);
}

function variantTextOf(result: DemoPersonaliseResponse): string {
  return result.kind === "text" ? result.text : caseTextOf(result.content);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function inWords(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function listInWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const SECTION_ORDER: { key: keyof SectionPresence; label: string }[] = [
  { key: "scenario", label: "scenario" },
  { key: "discussionQuestions", label: "discussion questions" },
  { key: "modelAnswers", label: "model answers" },
  { key: "rubric", label: "rubric" },
];

function present(s: SectionPresence): string[] {
  return SECTION_ORDER.filter(({ key }) => s[key]).map(({ label }) => label);
}

function absent(s: SectionPresence): string[] {
  return SECTION_ORDER.filter(({ key }) => !s[key]).map(({ label }) => label);
}

export function leftOutRuleInWords(rule: RejectionReason, budget: number): string {
  if (rule === "below-threshold") return "below the similarity threshold";
  if (rule === "over-budget") return `over the ${inWords(budget)}-note budget`;
  if (rule === "case-design-cap") return "the one case-design slot was taken";
  return String(rule);
}

function hadNotes(trace: RetrievalTrace | null): boolean {
  return !!trace && trace.status === "ok" && trace.notes.length > 0;
}

// Draft step

// The four sections, named as the card names them.
const SECTION_LIST = "scenario, questions, answers, rubric";

function structureCard(left: GenerateResult, right: GenerateResult): DifferenceCard {
  const ls = left.signals.sections;
  const rs = right.signals.sections;
  const rightAll = absent(rs).length === 0;
  const rightPart = rightAll
    ? `PersCase returned all four (${SECTION_LIST}) in a fixed structure`
    : `PersCase returned ${listInWords(present(rs)) || "none of the sections"} (${present(rs).length} of 4) in a fixed structure`;
  const notes = hadNotes(right.retrieval)
    ? "only PersCase had retrieved notes"
    : "neither column had retrieved notes on this run";
  let sentence: string;
  const detail: string[] = [];
  if (left.kind === "text") {
    sentence = `${LEFT} returned free text with ${present(ls).length} of 4 sections; ${rightPart}.`;
    detail.push(
      `${LEFT} sections found by heading: ${listInWords(present(ls)) || "none"}; not found: ${listInWords(absent(ls)) || "none"}.`,
    );
  } else if (rightAll && absent(ls).length === 0) {
    sentence = `Both columns returned all four sections (${SECTION_LIST}) in a fixed structure; ${notes}.`;
  } else {
    sentence = `Both columns returned a fixed structure (${LEFT}: ${present(ls).length} of 4 sections with content; PersCase: ${present(rs).length} of 4); ${notes}.`;
  }
  return { id: "structure", title: "Structure", sentence, detail: detail.length ? detail : undefined };
}

// Retrieval step

// The notes themselves, their scores and the left-out note are listed in the
// panel directly above the card, so the card gives only the counts and points
// back to that list.
function sourcesCard(trace: RetrievalTrace): DifferenceCard {
  let rightPart: string;
  if (trace.status === "retrieval-off") {
    rightPart = "none either; retrieval is switched off on this deployment";
  } else if (trace.status === "corpus-not-embedded") {
    rightPart = "none either; the notes are not embedded on this deployment";
  } else if (trace.notes.length === 0) {
    rightPart = "none; no note passed retrieval for this brief";
  } else {
    rightPart = `${plural(trace.notes.length, "note")}${trace.leftOut ? ", one left out" : ""} (see the list above)`;
  }
  return {
    id: "sources",
    title: "Retrieved notes",
    sentence: `${LEFT}: none. PersCase: ${rightPart}.`,
  };
}

function conceptCard(left: GenerateResult, right: GenerateResult): DifferenceCard {
  const covered = right.signals.conceptsCovered;
  const missing = right.signals.conceptsMissing;
  const n = covered.length + missing.length;
  const unmentioned = right.retrieval?.unmentionedConcepts ?? [];
  let sentence: string;
  if (n === 0) {
    sentence = `The brief lists no must-cover concepts, so PersCase's check had nothing to look for; the standard column has no check.`;
  } else {
    // Two facts, two sentences: what the check found in the draft, and which
    // concepts no retrieved note mentions. Joined in one sentence they read
    // as if the second explained the first, which it need not.
    const found =
      missing.length > 0
        ? `PersCase's check flagged ${listInWords(missing)} as missing from the draft.`
        : `PersCase's check shows all ${inWords(n)} must-cover concepts present in its draft.`;
    const notes =
      unmentioned.length > 0 ? ` No retrieved note mentions ${listInWords(unmentioned)}.` : "";
    sentence = `${found}${notes} The standard column has no check.`;
  }
  const detail: string[] = [];
  if (n > 0) {
    const a = left.signals.conceptsCovered.length;
    const ln = a + left.signals.conceptsMissing.length;
    detail.push(
      `For reference, the same word check on the ${LEFT} text shows ${a} of ${ln} present${
        left.signals.conceptsMissing.length > 0 ? ` (missing: ${listInWords(left.signals.conceptsMissing)})` : ""
      }.`,
    );
  }
  return { id: "concepts", title: "Must-cover check", sentence, detail: detail.length ? detail : undefined };
}

// Regeneration step

function regeneratedCard(
  section: CaseSection,
  before: ArmSignals,
  after: ArmSignals,
  regenerations: number,
): DifferenceCard {
  const flagged = before.conceptsMissing;
  const times = regenerations === 1 ? "one regeneration" : `${inWords(regenerations)} regenerations`;
  const n = after.conceptsCovered.length + after.conceptsMissing.length;
  const name = SECTION_NAMES[section];
  const start = `PersCase's check flagged ${listInWords(flagged)} in the generated draft.`;
  const sentence =
    after.conceptsMissing.length === 0
      ? `${start} After ${times} of the ${name}, the check shows all ${inWords(n)} concepts present. The standard column has no check and no regeneration.`
      : `${start} After ${times} of the ${name}, the check still shows ${listInWords(after.conceptsMissing)} missing; the instructor would edit by hand or regenerate again.`;
  // The title says "fixed" only when the check finds every concept.
  const title = after.conceptsMissing.length === 0 ? "Missed concept fixed" : "Missed concept";
  return { id: "regenerated", title, sentence };
}

// Variant step

// The rule personalisation follows, stated before the counts so that "kept"
// reads as what the rewrite was told to do, not as a check that passed.
export const PERSONALISATION_RULE =
  "PersCase changes only who the reader is and how they come to the case. It carries the organisation or the client's situation, the figures and the questions over as written and unverified. The standard prompt may change anything.";

// Below this many changed sentences the PersCase variant is close to its
// draft, and the card says so rather than letting the rule suggest a rewrite.
export const ALMOST_THE_DRAFT_BELOW = 3;
export const ALMOST_THE_DRAFT = "This variant is almost the draft.";

function almostTheDraft(right: DemoPersonaliseResponse): string {
  return right.differingSentences.differing < ALMOST_THE_DRAFT_BELOW ? ` ${ALMOST_THE_DRAFT}` : "";
}

function figuresCard(
  left: DemoPersonaliseResponse,
  right: DemoPersonaliseResponse,
  leftDraft: string | undefined,
  rightDraft: string | undefined,
): DifferenceCard {
  const ld = left.differingSentences;
  const rd = right.differingSentences;
  // A structured variant is compared on its scenario only, a free-text one as
  // a whole (see differingSentences), so each count names its unit.
  const unit = (r: DemoPersonaliseResponse) =>
    r.kind === "structured" ? "scenario sentences" : "sentences of its whole text";
  const sentencesOnly = leftDraft === undefined || rightDraft === undefined;
  if (sentencesOnly) {
    return {
      id: "figures",
      title: "What carries over",
      sentence: `${PERSONALISATION_RULE} PersCase's variant changed ${rd.differing} of ${rd.total} ${unit(right)}; the ${LEFT} variant changed ${ld.differing} of ${ld.total} ${unit(left)}.${almostTheDraft(right)}`,
    };
  }
  const lf = compareFigures(leftDraft, variantTextOf(left));
  const rf = compareFigures(rightDraft, variantTextOf(right));
  const pairs = (c: { from: string; to: string }[]) =>
    c.length > 0 ? c.map((p) => `${p.from} → ${p.to}`).join("; ") : "no figure replaced";
  return {
    id: "figures",
    title: "What carries over",
    sentence: `${PERSONALISATION_RULE} PersCase's variant kept ${rf.kept} of ${rf.total} figures and changed ${rd.differing} of ${rd.total} ${unit(right)}; the ${LEFT} variant kept ${lf.kept} of ${lf.total} figures and changed ${ld.differing} of ${ld.total} ${unit(left)}.${almostTheDraft(right)}`,
    detail: [`${LEFT}: ${pairs(lf.changed)}`, `PersCase: ${pairs(rf.changed)}`],
  };
}

// The caveat under drafts and variants

export type Discipline = "finance" | "marketing" | "social_work";

// What the tool does not verify in the model answers, by discipline: for
// finance the figures, for marketing the figures and the brands named, for
// social work the statements of law, agencies and consent as well as figures.
const MODEL_ANSWERS_CAVEAT: Record<Discipline, string> = {
  finance: "Figures in the model answers are the model's own and are not verified by the tool",
  marketing: "Figures and named brands in the model answers are the model's own and not verified",
  social_work:
    "Statements of law, agencies, consent and figures in the model answers are the model's own and not verified by the tool",
};

const TEXT_CAVEAT = "The figures in this text are the model's own and not verified";
const INSTRUCTOR_CHECKS = "the instructor checks them before approval";

/**
 * The caveat under a draft or a variant. A free-text result (the plain arm)
 * has no model-answers section, so it gets the sentence about its text. On the
 * PersCase side the caveat ends with the instructor's check, which is the step
 * the tool puts before approval; the standard column has no such step.
 */
export function modelAnswersCaveat(
  discipline: Discipline,
  opts: { freeText: boolean; perscase: boolean },
): string {
  const base = opts.freeText ? TEXT_CAVEAT : MODEL_ANSWERS_CAVEAT[discipline];
  return opts.perscase ? `${base}; ${INSTRUCTOR_CHECKS}.` : `${base}.`;
}

// Student step

export interface WorkedAnswerReading {
  found: boolean;
  // Figures in the reply that also occur in the case (years left out).
  caseFigures: number;
  formula: boolean;
  intrinsicValue: boolean;
}

// A reply carries a worked answer when it shows a calculation with numbers on
// both sides of "=", divides by a bracket, repeats two or more of the case's
// own figures, or names the intrinsic value the finance case asks for.
export function readWorkedAnswer(reply: string, caseText?: string): WorkedAnswerReading {
  const formula =
    /\d[^=\n]{0,80}=[^=\n]{0,80}\d/.test(reply) || /\/\s*\(/.test(reply) || /[×÷]\s*\(?\s*\d/.test(reply);
  const intrinsicValue = /\bintrinsic value\b/i.test(reply);
  let caseFigures = 0;
  if (caseText) {
    const inCase = new Set(extractFigures(caseText).filter((f) => f.kind !== "year").map(figureKey));
    const seen = new Set<string>();
    for (const f of extractFigures(reply)) {
      const k = figureKey(f);
      if (f.kind !== "year" && inCase.has(k) && !seen.has(k)) {
        seen.add(k);
        caseFigures++;
      }
    }
  }
  return { found: formula || intrinsicValue || caseFigures >= 2, caseFigures, formula, intrinsicValue };
}

function hintCard(
  left: DemoStudentResponse,
  right: Extract<DemoStudentResponse, { mode: "hint"; arm: "perscase" }>,
  caseText: string | undefined,
): DifferenceCard {
  const text = "text" in left ? left.text : "";
  const w = readWorkedAnswer(text, caseText);
  const hint = `hint ${right.index} of ${right.total}`;
  if (!w.found) {
    return {
      id: "withheld",
      title: "Answer withheld",
      sentence: `Neither reply contains a worked answer; PersCase returned ${hint}.`,
    };
  }
  const parts: string[] = [];
  if (w.caseFigures > 0) parts.push(`${plural(w.caseFigures, "figure")} from the case`);
  if (w.formula) parts.push("a formula");
  if (w.intrinsicValue && parts.length === 0) parts.push("a stated intrinsic value");
  return {
    id: "withheld",
    title: "Answer withheld",
    sentence: `The ${LEFT} wrote the answer for the student (${parts.join(", ")}). PersCase returned ${hint} and withheld the answer.`,
  };
}

function notRatedPhrase(reason: string): string {
  const m = reason.match(/(\d+) words? long/);
  if (m) return `${m[1]}-word answer as too short to judge against the rubric`;
  return "answer it could not relate to the case";
}

// Common English words that carry no content of their own. Together with the
// rule that a content word has four letters or more, they leave the words that
// say what a text is about.
const STOP_WORDS = new Set(
  (
    "about above after again against also because been before being below between both could " +
    "does doing down during each even every from further have having here hers herself himself " +
    "into itself just like made make many more most much must myself only other ours ourselves " +
    "over same should some such than that their theirs them themselves then there these they " +
    "this those through under until upon very were what when where which while whom whose will " +
    "with within without would your yours yourself yourselves"
  ).split(" "),
);

// The distinct content words of a text, lower-cased: words of four letters or
// more that are not stop words.
export function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
  return new Set(words.map((w) => w.replace(/['’].*$/, "")).filter((w) => w.length >= 4 && !STOP_WORDS.has(w)));
}

// The share of the reply's content words that also occur in the student's
// message at or above which the reply is read as a rewrite of the student's
// answer.
export const RESTATES_AT = 0.45;

export interface RestatementReading {
  // Distinct content words of the reply that also occur in the student's message.
  shared: number;
  total: number;
  restates: boolean;
}

// A reply restates the student's answer when at least 45 percent of its
// distinct content words also occur in the student's message. Word overlap rather than whole
// sentences, so that a reply that reorders or lightly rewords the draft is
// read the same way as one that copies it.
export function readRestatement(reply: string, message: string): RestatementReading {
  const inMessage = contentWords(message);
  const words = [...contentWords(reply)];
  const shared = words.filter((w) => inMessage.has(w)).length;
  return { shared, total: words.length, restates: words.length > 0 && shared >= RESTATES_AT * words.length };
}

function feedbackCard(
  left: DemoStudentResponse,
  right: Extract<DemoStudentResponse, { mode: "feedback"; arm: "perscase" }>,
  studentMessage: string | undefined,
): DifferenceCard {
  const m = "text" in left ? wordCount(left.text) : 0;
  const restated =
    "text" in left && studentMessage ? readRestatement(left.text, studentMessage) : null;
  // When the reply restates the answer, the card opens with that, and the
  // share of shared words follows in brackets.
  const rewrote = restated?.restates
    ? `The ${LEFT} rewrote the student's answer (${Math.round((100 * restated.shared) / restated.total)} percent of its content words are also in the student's message)`
    : null;
  if ("notRated" in right) {
    return {
      id: "rubric",
      title: "Graded against the rubric",
      sentence: rewrote
        ? `${rewrote}; PersCase declined to rate a ${notRatedPhrase(right.notRated.reason)}.`
        : `PersCase declined to rate a ${notRatedPhrase(right.notRated.reason)}; the ${LEFT} returned ${m} words.`,
      detail: [`PersCase's reason: ${right.notRated.reason}`],
    };
  }
  const criteria = right.assessment.criteria;
  const graded = `PersCase graded the answer against ${plural(criteria.length, "rubric criterion", "rubric criteria")} and gave a band${right.assessment.nextStep?.trim() ? ", and one next step" : ""}`;
  return {
    id: "rubric",
    title: "Graded against the rubric",
    sentence: rewrote
      ? `${rewrote}; ${graded}.`
      : `${graded}; the ${LEFT} returned ${m} words of prose with no criteria.`,
    detail:
      criteria.length > 0
        ? [`PersCase criteria: ${criteria.map((c) => c.criterion).join("; ")}.`]
        : undefined,
  };
}

const CARD_STEP: Record<string, DifferenceStep> = {
  sources: "retrieval",
  structure: "draft",
  concepts: "draft",
  regenerated: "regenerate",
  figures: "variant",
  withheld: "student",
  rubric: "student",
};

export function stepOfCards(cards: DifferenceCard[]): DifferenceStep | null {
  for (const c of cards) if (CARD_STEP[c.id]) return CARD_STEP[c.id];
  return null;
}

export function computeDifferences(input: DifferencesInput): DifferenceCard[] {
  if (input.step === "retrieval") {
    return input.trace ? [sourcesCard(input.trace)] : [];
  }
  if (input.step === "regenerate") {
    if (input.before.conceptsMissing.length === 0) return [];
    return [regeneratedCard(input.section, input.before, input.after, input.regenerations ?? 1)];
  }
  if (input.step === "draft") {
    const left = unwrap(input.left);
    const right = unwrap(input.right);
    if (!left || !right) return [];
    return [structureCard(left, right), conceptCard(left, right)];
  }
  if (input.step === "variant") {
    const left = unwrap(input.left);
    const right = unwrap(input.right);
    if (!left || !right) return [];
    return [figuresCard(left, right, input.leftDraftText, input.rightDraftText)];
  }
  const left = unwrap(input.left);
  const right = unwrap(input.right);
  if (!left || !right || right.arm !== "perscase") return [];
  if (right.mode === "hint") return [hintCard(left, right, input.caseText)];
  return [feedbackCard(left, right, input.studentMessage)];
}
