import { generateText } from "ai";
import { describeGenerationModel, getGenerationModel } from "@/lib/llm/client";
import { promptPackRetrieval } from "@/lib/retrieval/prompt-pack-provider";
import {
  groundingUtilisation,
  type GroundingBrief,
  type GroundingUtilisation,
} from "@/lib/retrieval/grounding";
import type { CaseInput } from "@/lib/disciplines/types";
import {
  generateCase,
  checkConceptCoverage,
  type ConceptMatch,
  type ModelCallOptions,
} from "./generate-case";
import type { CaseTextFields, GenerationOutput } from "./schema";

// The contrastive view runs the same brief through three arms so an instructor
// can see what each part of the pipeline contributes:
//
//   plain       one unstructured prompt, no retrieval, no schema, no
//               discipline pack: what a chatbot returns for the same brief
//   structured  the normal structured generation path with retrieval switched
//               off (discipline-pack grounding only)
//   perscase    the case's current draft, read from the database as it stands,
//               instructor edits included, and never regenerated here
//
// Only the first two are generated on demand, and both are cached per case.

export type ArmId = "plain" | "structured" | "perscase";

export const ARM_LABELS: Record<ArmId, string> = {
  plain: "Plain prompt",
  structured: "Structured, no retrieval",
  perscase: "This case, current draft",
};

export const ARM_BLURBS: Record<ArmId, string> = {
  plain: "One prompt to the same model, as a general chatbot would receive it. No retrieval, no structured output, no discipline prompt.",
  structured:
    "The same structured generation with retrieval switched off: discipline prompt and structured output, no retrieved notes.",
  perscase:
    "The case as it stands now: generated with retrieved notes and structured output, then edited by the instructor. Any hand edits and regenerated sections are in this column. It is read from the database and is not regenerated here, so it is not a like-for-like sample against the two baselines.",
};

// Arm 1: plain, unstructured generation

// Deliberately close to what an instructor would type into a general-purpose
// chatbot: the same brief in prose, with no schema and no discipline grounding.
export function buildPlainPrompt(input: CaseInput): string {
  const p = input.targetLearnerProfile;
  return [
    `Write a teaching case study for a university course.`,
    ``,
    `Learning objective: ${input.learningObjective}`,
    `Difficulty: ${input.difficulty}`,
    `Concepts it must cover: ${input.mustCoverConcepts.join(", ") || "(none specified)"}`,
    `The learners work in ${p.industry} as ${p.role}, with ${p.priorKnowledge} prior knowledge.`,
    ``,
    `Include discussion questions and explain how you would assess the answers.`,
  ].join("\n");
}

export interface PlainArmResult {
  text: string;
  modelId: string;
}

export async function generatePlainCase(
  input: CaseInput,
  options: ModelCallOptions = {},
): Promise<PlainArmResult> {
  const { text } = await generateText({
    model: getGenerationModel(),
    prompt: buildPlainPrompt(input),
    temperature: 0.8,
    maxTokens: options.maxTokens,
  });
  return { text: text.trim(), modelId: describeGenerationModel() };
}

// Arm 2: structured generation, retrieval off

export async function generateStructuredNoRetrieval(
  input: CaseInput,
  options: ModelCallOptions = {},
) {
  // Passing the prompt-pack provider explicitly keeps the discipline pack and
  // the output schema in play while removing the retrieved passages, so the
  // only thing that differs from the PersCase arm is grounding.
  return generateCase(input, promptPackRetrieval, options);
}

// Signals

export interface SectionPresence {
  scenario: boolean;
  discussionQuestions: boolean;
  modelAnswers: boolean;
  rubric: boolean;
}

export interface ArmSignals {
  // Lexical must-cover concept check, the same routine the editor runs.
  conceptsCovered: string[];
  conceptsMissing: string[];
  // Per-concept detail, including the phrase in this arm's text that matched.
  concepts: ConceptMatch[];
  // How many of the notes this case retrieved are reflected in this arm's text.
  // Every arm is read against the same note set. Null only when the case has no
  // recorded retrieval to read against.
  grounding: GroundingUtilisation | null;
  sections: SectionPresence;
  wordCount: number;
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Heading patterns a free-text case tends to use for each structured section.
// Matched against the start of a line so a passing mention in a sentence does
// not count as a section.
const SECTION_HEADINGS: Record<keyof SectionPresence, RegExp> = {
  scenario:
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*{0,2}|_{0,2})[ \t]*(?:part [ivx0-9]+[:.\-—) ]*)?(?:the )?(?:case (?:study|background|scenario|overview|description)|scenario|background|overview|situation|setting|context)\b/im,
  discussionQuestions:
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*{0,2}|_{0,2})[ \t]*(?:discussion questions?|questions? for discussion|questions?|discussion prompts?)\b/im,
  modelAnswers:
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*{0,2}|_{0,2})[ \t]*(?:model answers?|suggested answers?|sample answers?|indicative answers?|answer key|teaching notes?|suggested responses?)\b/im,
  rubric:
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*{0,2}|_{0,2})[ \t]*(?:rubric|assessment(?: criteria| rubric)?|grading (?:rubric|criteria|scheme)|marking (?:rubric|criteria|scheme)|evaluation criteria|how (?:i|we) would assess)\b/im,
};

// A free-text arm has no schema, so section presence is a heuristic over
// headings, with one fallback: three or more lines ending in a question mark
// count as a discussion-question block even when the heading is missing.
export function detectSections(text: string): SectionPresence {
  const questionLines = text
    .split("\n")
    .filter((line) => /\?\s*$/.test(line.trim())).length;
  return {
    scenario: SECTION_HEADINGS.scenario.test(text),
    discussionQuestions:
      SECTION_HEADINGS.discussionQuestions.test(text) || questionLines >= 3,
    modelAnswers: SECTION_HEADINGS.modelAnswers.test(text),
    rubric: SECTION_HEADINGS.rubric.test(text),
  };
}

// A structured arm satisfies the schema by construction, so a section counts as
// present when its field actually carries content.
export function structuredSections(content: CaseTextFields): SectionPresence {
  return {
    scenario: content.scenario.trim().length > 0,
    discussionQuestions: content.discussionQuestions.length > 0,
    modelAnswers: content.modelAnswers.length > 0,
    rubric: content.rubric.trim().length > 0,
  };
}

// Free text has no fields to walk, so the whole document is passed as the
// scenario. checkConceptCoverage concatenates the four fields before matching,
// which makes this equivalent to running the same lexical check over the text.
export function asTextFields(text: string): CaseTextFields {
  return { scenario: text, discussionQuestions: [], modelAnswers: [], rubric: "" };
}

// `provenance` is always the PersCase arm's retrieval, whichever arm is being
// scored. The baselines never retrieved anything, so asking how many of their
// own passages they reflect has no answer; asking how much of the same
// grounding material each arm's text carries does, and it is a reading all
// three columns can be compared on.
function groundingAgainst(
  content: CaseTextFields,
  provenance: string[] | null,
  brief: GroundingBrief,
): ArmSignals["grounding"] {
  if (!provenance) return null;
  const g = groundingUtilisation(content, provenance, brief);
  return g.total > 0 ? g : null;
}

export function plainSignals(
  text: string,
  brief: GroundingBrief,
  provenance: string[] | null = null,
): ArmSignals {
  const fields = asTextFields(text);
  const coverage = checkConceptCoverage(fields, brief.mustCoverConcepts);
  return {
    conceptsCovered: coverage.covered,
    conceptsMissing: coverage.missing,
    concepts: coverage.concepts,
    grounding: groundingAgainst(fields, provenance, brief),
    sections: detectSections(text),
    wordCount: wordCount(text),
  };
}

export function structuredSignals(
  content: CaseTextFields,
  brief: GroundingBrief,
  provenance: string[] | null,
): ArmSignals {
  const coverage = checkConceptCoverage(content, brief.mustCoverConcepts);
  return {
    conceptsCovered: coverage.covered,
    conceptsMissing: coverage.missing,
    concepts: coverage.concepts,
    grounding: groundingAgainst(content, provenance, brief),
    sections: structuredSections(content),
    wordCount: wordCount(
      [
        content.scenario,
        content.discussionQuestions.join(" "),
        content.modelAnswers.join(" "),
        content.rubric,
      ].join(" "),
    ),
  };
}

// View model shared by the compare page and the compare API

export interface ComparisonArm {
  id: ArmId;
  label: string;
  blurb: string;
  kind: "text" | "structured";
  text?: string;
  content?: CaseTextFields;
  signals: ArmSignals;
}

export interface ComparisonBrief {
  discipline: string;
  learningObjective: string;
  difficulty: string;
  mustCoverConcepts: string[];
  targetLearnerProfile: { industry: string; role: string; priorKnowledge: string };
}

// What each arm was given. The three arms form a progression: the plain prompt
// has the brief only; the structured arm adds the discipline prompt and the
// output schema; the PersCase arm adds the retrieved notes and, after
// generation, whatever the instructor changed. The inputs strip at the top of
// the view states this in one table so a reader does not infer it from prose.
export interface ArmInputs {
  brief: true;
  disciplinePrompt: boolean;
  outputSchema: boolean;
  retrievedNotes: boolean;
  instructorEdits: boolean;
}

export const ARM_INPUTS: Record<ArmId, ArmInputs> = {
  plain: { brief: true, disciplinePrompt: false, outputSchema: false, retrievedNotes: false, instructorEdits: false },
  structured: { brief: true, disciplinePrompt: true, outputSchema: true, retrievedNotes: false, instructorEdits: false },
  perscase: { brief: true, disciplinePrompt: true, outputSchema: true, retrievedNotes: true, instructorEdits: true },
};

// The cumulative reading of each column, for the header line under its label.
export const ARM_ADDS: Record<ArmId, string> = {
  plain: "the brief only",
  structured: "+ discipline prompt and output schema",
  perscase: "+ retrieved notes, then the instructor's edits",
};

// What the instructor did to the PersCase arm after generation, read from the
// event log. Both baselines are single samples and have none of this.
export interface EditSummary {
  saves: number;
  // Sections changed by in-place saves, in first-changed order.
  sectionsChanged: string[];
  regenerations: number;
  regeneratedSections: string[];
  // Sections whose regenerated text the instructor put back.
  restoredSections: string[];
}

export interface ComparisonView {
  caseId: string;
  brief: ComparisonBrief;
  // What the instructor did to the draft after generation, or null when the
  // event log holds nothing (an unedited draft).
  edits: EditSummary | null;
  // False when the two generated arms have not been produced for this case yet.
  cached: boolean;
  generatedAt: string | null;
  modelId: string | null;
  arms: ComparisonArm[];
}

export interface CachedComparison {
  plainText: string;
  structuredJson: GenerationOutput;
  structuredProvenance: string[];
  modelId: string;
  generatedAt: Date;
}

export function buildComparisonView(args: {
  caseId: string;
  input: CaseInput;
  // The case's own approved/generated draft.
  teamContent: CaseTextFields | null;
  // Provenance recorded with the case's last completed generation, used for the
  // grounding column of the PersCase arm.
  teamProvenance: string[] | null;
  cached: CachedComparison | null;
  edits?: EditSummary | null;
}): ComparisonView {
  const { caseId, input, teamContent, teamProvenance, cached } = args;
  const edits = args.edits ?? null;
  const mustCover = input.mustCoverConcepts;
  const arms: ComparisonArm[] = [];

  if (cached) {
    arms.push({
      id: "plain",
      label: ARM_LABELS.plain,
      blurb: ARM_BLURBS.plain,
      kind: "text",
      text: cached.plainText,
      signals: plainSignals(cached.plainText, input, teamProvenance),
    });
    arms.push({
      id: "structured",
      label: ARM_LABELS.structured,
      blurb: ARM_BLURBS.structured,
      kind: "structured",
      content: cached.structuredJson,
      // Scored against the PersCase arm's retrieval, not this arm's own
      // provenance, which carries no corpus passages by construction.
      signals: structuredSignals(cached.structuredJson, input, teamProvenance),
    });
  }

  if (teamContent) {
    arms.push({
      id: "perscase",
      label: ARM_LABELS.perscase,
      blurb: ARM_BLURBS.perscase,
      kind: "structured",
      content: teamContent,
      signals: structuredSignals(teamContent, input, teamProvenance),
    });
  }

  return {
    caseId,
    edits,
    brief: {
      discipline: input.discipline,
      learningObjective: input.learningObjective,
      difficulty: input.difficulty,
      mustCoverConcepts: mustCover,
      targetLearnerProfile: input.targetLearnerProfile,
    },
    cached: Boolean(cached),
    generatedAt: cached ? cached.generatedAt.toISOString() : null,
    modelId: cached?.modelId ?? null,
    arms,
  };
}
