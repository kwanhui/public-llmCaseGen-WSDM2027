import { generateObject } from "ai";
import { getGenerationModel } from "@/lib/llm/client";
import { getDisciplinePack } from "@/lib/disciplines";
import { getRetrievalProvider } from "@/lib/retrieval";
import type { RetrievalProvider } from "@/lib/retrieval/provider";
import type { CaseInput, FewShotExemplar } from "@/lib/disciplines/types";
import {
  findPhrase,
  normalisedWords,
  quote,
  smallestWindow,
  splitSentences,
  tokenise,
  type LexicalToken,
} from "@/lib/text/lexical";
import { GenerationOutputSchema, type GenerationOutput, type CaseTextFields } from "./schema";

function formatExemplar(ex: FewShotExemplar, index: number): string {
  return [
    `### Exemplar ${index + 1}: ${ex.title}`,
    ``,
    `**Scenario:** ${ex.scenario}`,
    ``,
    `**Discussion questions:**`,
    ...ex.discussionQuestions.map((q, i) => `${i + 1}. ${q}`),
    ``,
    `**Rubric:** ${ex.rubric}`,
  ].join("\n");
}

// Model answers were the weakest part of the drafts instructors reviewed: they
// introduced inputs the scenario never stated and reported results without the
// working, so an error was hard to locate. The rule below is attached to every
// prompt that produces model answers (full case, variant, section
// regeneration). It is an instruction, not a check: PersCase still does not
// verify arithmetic.
export const MODEL_ANSWER_RULE = [
  "Model answers may use only figures that the scenario states.",
  "Do not assume, invent, or illustrate with a number that is not in the scenario.",
  "If a question needs a figure the scenario does not give, say so in the answer and name what the learner would need.",
  "Write out the calculation before the result, so the arithmetic can be checked line by line.",
  "Write it in plain text, as the numbers and operators themselves, for example 5.04 / (0.10 - 0.05) = 100.80. Do not use LaTeX or any other markup for the formulas.",
].join(" ");

export function buildUserPrompt(
  input: CaseInput,
  groundingText: string,
  exemplars: FewShotExemplar[],
): string {
  const profile = input.targetLearnerProfile;
  return [
    `# Case authoring task`,
    ``,
    `**Learning objective:** ${input.learningObjective}`,
    `**Difficulty:** ${input.difficulty}`,
    `**Must-cover concepts:** ${input.mustCoverConcepts.join(", ") || "(none specified)"}`,
    ``,
    `**Target learner profile**`,
    `- Industry / practice context: ${profile.industry}`,
    `- Role: ${profile.role}`,
    `- Prior knowledge: ${profile.priorKnowledge}`,
    ``,
    `## Discipline grounding`,
    groundingText,
    ``,
    `## Reference exemplars (for style and depth, not content)`,
    exemplars.map(formatExemplar).join("\n\n"),
    ``,
    `## Rule for the model answers`,
    MODEL_ANSWER_RULE,
    ``,
    `Now author a fresh case following the structured output schema. Do not reuse content from the exemplars verbatim.`,
  ].join("\n");
}

export interface GenerateCaseResult {
  output: GenerationOutput;
  // Retrieval provenance (model id + retrieved corpus chunk ids with scores),
  // logged with the generation event for transparency and reproducibility.
  provenance: string[];
}

// Models sometimes prefix the scenario with a "Scenario:" label, or with a
// Markdown heading such as "### Scenario", and number the discussion questions
// and answers, which then double up with the UI's own numbering. Normalise so
// each field holds clean content, matching the schema's intent and what the
// editor and student view render.
export function normalizeOutput<T extends Partial<GenerationOutput>>(o: T): T {
  const stripScenarioLabel = (s: string) =>
    s.replace(/^\s*(?:#{1,6}\s+)?\*{0,2}\s*scenario\s*:?\s*\*{0,2}\s*/i, "").trim();
  const stripEnumerator = (s: string) =>
    s.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").trim();
  const out: Partial<GenerationOutput> = {};
  if (o.scenario !== undefined) out.scenario = stripScenarioLabel(o.scenario);
  if (o.discussionQuestions !== undefined)
    out.discussionQuestions = o.discussionQuestions.map(stripEnumerator);
  if (o.modelAnswers !== undefined) out.modelAnswers = o.modelAnswers.map(stripEnumerator);
  if (o.rubric !== undefined) out.rubric = o.rubric.trim();
  return { ...o, ...out };
}

// Options for a single model call. `maxTokens` caps the output; the public demo
// routes set it, and the instructor routes leave it to the provider default.
export interface ModelCallOptions {
  maxTokens?: number;
}

// `provider` defaults to the configured retrieval provider. The contrastive
// view passes the prompt-pack provider explicitly to produce a structured draft
// with retrieval switched off, holding everything else constant.
export async function generateCase(
  input: CaseInput,
  provider: RetrievalProvider = getRetrievalProvider(),
  options: ModelCallOptions = {},
): Promise<GenerateCaseResult> {
  const pack = getDisciplinePack(input.discipline);
  const retrieval = await provider.retrieve(input);
  const userPrompt = buildUserPrompt(input, retrieval.groundingText, retrieval.exemplars);

  const { object } = await generateObject({
    model: getGenerationModel(),
    schema: GenerationOutputSchema,
    system: pack.systemPrompt,
    prompt: userPrompt,
    temperature: 0.8,
    maxTokens: options.maxTokens,
  });

  return { output: normalizeOutput(object), provenance: retrieval.provenance };
}

// A difficulty proxy for the editor. The requested difficulty is a prompt
// instruction and the model may not follow it, so the editor shows a surface
// signal to compare with the request: scenario length, the count of distinct
// numeric tokens (a rough stand-in for quantitative load) and the number of
// discussion questions, mapped to a coarse band. It is not a validated measure
// of difficulty, and the interface says so.
export type DifficultyBand = "lighter" | "as-requested" | "heavier";

export interface DifficultySignal {
  band: DifficultyBand;
  scenarioWords: number;
  numericTokens: number;
  questionCount: number;
  note: string;
}

export function difficultySignal(
  output: CaseTextFields,
  requested: "novice" | "intermediate" | "advanced",
): DifficultySignal {
  const scenarioWords = output.scenario.trim().split(/\s+/).filter(Boolean).length;
  const numericTokens = new Set(
    (output.scenario.match(/\d+(?:[.,]\d+)?%?/g) ?? []).map((t) => t.toLowerCase()),
  ).size;
  const questionCount = output.discussionQuestions.length;

  // A crude load score: longer scenarios with more numbers and more questions
  // read as harder. Thresholds are deliberately wide so the signal only fires
  // on clear mismatches.
  const load = scenarioWords / 100 + numericTokens + questionCount;
  const expected: Record<typeof requested, [number, number]> = {
    novice: [4, 9],
    intermediate: [7, 14],
    advanced: [11, 99],
  };
  const [lo, hi] = expected[requested];
  let band: DifficultyBand = "as-requested";
  if (load < lo) band = "lighter";
  else if (load > hi) band = "heavier";

  const level =
    band === "as-requested"
      ? `in the range set for ${requested}`
      : `${band === "heavier" ? "above" : "below"} ${requested}`;
  const note = `${level}, estimated from scenario length, numbers and question count`;
  return { band, scenarioWords, numericTokens, questionCount, note };
}


export interface ConceptPartMatch {
  // One half of a concept written as a tension, for example the two sides of
  // "mandatory reporting vs client self-determination".
  part: string;
  matched: boolean;
  matchedPhrase: string | null;
}

export interface ConceptMatch {
  concept: string;
  matched: boolean;
  // The stretch of case text that satisfied the check, shown to the instructor.
  // Null when the concept was not found.
  matchedPhrase: string | null;
  // "phrase" when the concept's words appear together in order, "window" when
  // its content words appear close to each other inside one sentence, "split"
  // when the concept was written as a tension and each half was found.
  rule: "phrase" | "window" | "split" | null;
  // The halves of a concept written as a tension, with what each one matched.
  // Empty for a concept that was not split.
  parts: ConceptPartMatch[];
}

export interface ConceptCoverageReport {
  missing: string[];
  covered: string[];
  concepts: ConceptMatch[];
  // The parts of the case that the check reads.
  sectionsChecked: string[];
  // One sentence describing the rule, for the interface and for result files.
  method: string;
}

// The sections the check reads. The rubric and the glossary are left out: a
// concept named in a rubric criterion or defined in a glossary entry is a
// label, not a use of the concept in the case.
export const COVERAGE_SECTIONS = ["scenario", "discussion questions", "model answers"];

export const COVERAGE_METHOD =
  "Lexical check over the scenario, the discussion questions and the model answers. " +
  "The rubric and the glossary are not read. A concept matches inside a single sentence, " +
  "either as its words in order or as its content words within a short window, after " +
  "normalising spelling variants, plurals and simple stems. A concept written as a tension " +
  "(X vs Y, X/Y) is split, and each half has to match somewhere in those sections.";

// Post-generation lexical check (not semantic). It is a word-level match, not a
// substring match, run over the same normalisation on both sides: the concept
// the instructor typed and the text the model wrote (lib/text/lexical.ts).
//
// Words inside a multi-word concept that carry no meaning of their own are
// dropped, so "cost of equity via CAPM" is really the three words cost, equity
// and CAPM. Those three have to appear close to one another inside one
// sentence, not merely somewhere in the case.
const COVERAGE_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "for", "on", "with", "by", "at",
  "via", "using", "from", "as", "its", "their", "this", "that", "is", "are", "be",
]);

// The content words of a concept must all fall inside one window of this many
// words, and inside one sentence. Two words of filler are allowed between
// consecutive content words, which is enough for "Cost of equity (using CAPM)"
// and not enough for a sentence that happens to contain customer, lifetime and
// value in unrelated places.
const COVERAGE_WINDOW_FILLER = 2;

function maxWindowFor(contentWords: number): number {
  return contentWords + COVERAGE_WINDOW_FILLER * (contentWords - 1);
}

// How much matched text to quote back in the interface.
const MATCHED_PHRASE_MAX_CHARS = 140;

// A concept written as a tension between two ideas is two requirements, not one
// phrase: "mandatory reporting vs client self-determination" is covered when a
// case discusses both, wherever each is discussed. The separators are the ones
// instructors actually type.
const CONCEPT_SPLIT = /\s+vs\.?\s+|\s+versus\s+|\s+v\.\s+|\s*\/\s*/i;

function contentWordsOf(concept: string): string[] {
  return normalisedWords(concept).filter((w) => w.length > 0 && !COVERAGE_STOPWORDS.has(w));
}

// Split only when every half carries a content word of its own, so "A/B
// testing" stays one concept while "confidentiality / information sharing"
// becomes two requirements.
function splitConcept(concept: string): string[] {
  const parts = concept
    .split(CONCEPT_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 2) return [];
  return parts.every((p) => contentWordsOf(p).length > 0) ? parts : [];
}

interface SentenceSpan {
  start: number;
  tokens: LexicalToken[];
}

// One match of a single concept (or of one half of a split concept), searched
// sentence by sentence. A phrase match anywhere in the text is preferred over a
// window match, so the quoted evidence is the tightest available.
function matchConcept(
  haystack: string,
  sentences: SentenceSpan[],
  concept: string,
): { matchedPhrase: string; rule: "phrase" | "window" } | null {
  const phrase = normalisedWords(concept);
  const content = contentWordsOf(concept);
  // A concept made only of stop-words is not a concept, so it never counts as
  // covered no matter how often those words appear.
  if (content.length === 0) return null;

  for (const s of sentences) {
    const hit = findPhrase(s.tokens, phrase);
    if (hit) {
      return {
        matchedPhrase: quote(haystack, s.tokens, hit.from, hit.to, MATCHED_PHRASE_MAX_CHARS),
        rule: "phrase",
      };
    }
  }

  const maxSpan = maxWindowFor(content.length);
  for (const s of sentences) {
    const window = smallestWindow(s.tokens, content);
    if (window && window.length <= maxSpan) {
      return {
        matchedPhrase: quote(
          haystack,
          s.tokens,
          window.from,
          window.to,
          MATCHED_PHRASE_MAX_CHARS,
        ),
        rule: "window",
      };
    }
  }
  return null;
}

export function checkConceptCoverage(
  output: CaseTextFields,
  mustCover: string[],
): ConceptCoverageReport {
  const haystack = [
    output.scenario,
    output.discussionQuestions.join("\n"),
    output.modelAnswers.join("\n"),
  ].join("\n\n");
  const sentences: SentenceSpan[] = splitSentences(haystack).map((span) => ({
    start: span.start,
    tokens: tokenise(haystack.slice(span.start, span.end), span.start),
  }));

  const missing: string[] = [];
  const covered: string[] = [];
  const concepts: ConceptMatch[] = [];

  for (const concept of mustCover) {
    const halves = splitConcept(concept);

    if (halves.length > 0) {
      const parts: ConceptPartMatch[] = halves.map((part) => {
        const hit = matchConcept(haystack, sentences, part);
        return { part, matched: hit !== null, matchedPhrase: hit?.matchedPhrase ?? null };
      });
      const allMatched = parts.every((p) => p.matched);
      if (allMatched) covered.push(concept);
      else missing.push(concept);
      concepts.push({
        concept,
        matched: allMatched,
        matchedPhrase: allMatched
          ? parts.map((p) => p.matchedPhrase).join(" … ")
          : null,
        rule: allMatched ? "split" : null,
        parts,
      });
      continue;
    }

    const hit = matchConcept(haystack, sentences, concept);
    if (hit) {
      covered.push(concept);
      concepts.push({
        concept,
        matched: true,
        matchedPhrase: hit.matchedPhrase,
        rule: hit.rule,
        parts: [],
      });
    } else {
      missing.push(concept);
      concepts.push({ concept, matched: false, matchedPhrase: null, rule: null, parts: [] });
    }
  }

  return {
    missing,
    covered,
    concepts,
    sectionsChecked: COVERAGE_SECTIONS,
    method: COVERAGE_METHOD,
  };
}
