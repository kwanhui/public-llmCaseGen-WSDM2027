import { generateObject } from "ai";
import { z } from "zod";
import { getGenerationModel } from "@/lib/llm/client";
import { getDisciplinePack } from "@/lib/disciplines";
import { getRetrievalProvider } from "@/lib/retrieval";
import { normalizeOutput, MODEL_ANSWER_RULE, type ModelCallOptions } from "./generate-case";
import type { CaseInput } from "@/lib/disciplines/types";
import type { RetrievalProvider } from "@/lib/retrieval/provider";
import type { CaseContent, CaseSection } from "./schema";

// The array bounds match the case schema, so a regenerated list that the editor
// could not open is rejected at the model call rather than after it.
const SectionOutputSchema = z.object({
  scenario: z.string().optional(),
  discussionQuestions: z
    .array(z.string().describe("One question. Never several questions in one string."))
    .min(3)
    .max(8)
    .optional(),
  modelAnswers: z
    .array(z.string().describe("One answer. Never several answers in one string."))
    .min(3)
    .max(8)
    .optional(),
  rubric: z.string().optional(),
});

export interface RegenerateSectionInput {
  input: CaseInput;
  currentContent: CaseContent;
  section: CaseSection;
  editorNote?: string;
  // Must-cover concepts the lexical check did not find in the current draft.
  // Named in the prompt for the sections that can carry them, so a regeneration
  // prompted by the missing-concept line has a chance of fixing it rather than
  // returning a paraphrase with the same gap.
  missingConcepts?: string[];
  // Set on the retry after a regeneration returned a different number of model
  // answers from discussion questions. The 1:1 wording in the section
  // instruction did not hold, so the retry says the count outright.
  answerCountRetry?: boolean;
  // The notes to ground the regeneration in. The instructor's route leaves it
  // out and retrieval runs again; the public demo passes the notes its draft
  // was generated from (providerFromProvenance), so that no embedding call is
  // made and the grounding is the same set.
  provider?: RetrievalProvider;
  options?: ModelCallOptions;
}

const SECTION_INSTRUCTIONS: Record<CaseSection, string> = {
  scenario:
    "Regenerate the scenario only. Keep the discussion questions, model answers, and rubric unchanged. Preserve the learning objective and must-cover concepts. Make the scenario tighter, fresher, or more specific to the learner profile, depending on the editor's note.",
  discussionQuestions:
    "Regenerate the discussion questions and the matching model answers only. Keep the scenario and rubric unchanged. Maintain a 1:1 correspondence between questions and answers. Return each question as its own item in the array, and each answer as its own item: never several questions or answers in one string, and no leading numbers. Apply the editor's note if given.",
  modelAnswers:
    "Regenerate the model answers only. Keep the scenario, discussion questions, and rubric unchanged. Maintain 1:1 correspondence with the existing discussion questions. Return each answer as its own item in the array: never several answers in one string, and no leading numbers. Apply the editor's note if given.",
  rubric:
    "Regenerate the rubric only. Keep the scenario, discussion questions, and model answers unchanged. Use 4 weighted criteria with single-sentence 'what excellent looks like' descriptors. Apply the editor's note if given.",
};

export interface RegenerateSectionResult {
  patch: Partial<CaseContent>;
  provenance: string[];
}

// Sections whose text can be made to carry a missing concept: the ones the
// must-cover check reads (the scenario, the questions and the model answers).
// The check does not read the rubric, so the list is not passed there.
const CONCEPT_REPAIR_SECTIONS: CaseSection[] = ["scenario", "discussionQuestions", "modelAnswers"];

// Sections that produce model answers, and so carry the figures rule.
const ANSWER_SECTIONS: CaseSection[] = ["discussionQuestions", "modelAnswers"];

export async function regenerateSection({
  input,
  currentContent,
  section,
  editorNote,
  missingConcepts,
  answerCountRetry,
  provider = getRetrievalProvider(),
  options = {},
}: RegenerateSectionInput): Promise<RegenerateSectionResult> {
  const pack = getDisciplinePack(input.discipline);
  const retrieval = await provider.retrieve(input);

  const sectionInstructions = SECTION_INSTRUCTIONS[section];
  const noteBlock = editorNote
    ? `\n## Editor's note for this regeneration\n${editorNote}\n`
    : "";
  const missing = missingConcepts?.filter((c) => c.trim() !== "") ?? [];
  const missingBlock =
    missing.length > 0 && CONCEPT_REPAIR_SECTIONS.includes(section)
      ? [
          ``,
          `## Concepts the current draft does not name`,
          `A word-level check did not find these must-cover concepts anywhere in the case: ${missing.join(", ")}.`,
          `Write this section so that each of them appears by name and is needed to answer the case, using the instructor's wording for the concept.`,
          // The questions stay as they are when only the answers are
          // regenerated, so the answers have to bring the concept in.
          ...(section === "modelAnswers"
            ? [
                `The discussion questions stay as they are, so name each concept, in exactly that wording, in the answer to the question it bears on most, as something that answer weighs.`,
              ]
            : []),
          ``,
        ].join("\n")
      : "";
  const answerBlock = ANSWER_SECTIONS.includes(section)
    ? `\n## Rule for the model answers\n${MODEL_ANSWER_RULE}\n`
    : "";
  const countBlock =
    answerCountRetry && ANSWER_SECTIONS.includes(section)
      ? [
          ``,
          `## Counts`,
          section === "modelAnswers"
            ? `The last attempt returned the wrong number of model answers. Return exactly ${currentContent.discussionQuestions.length} model answers, one for each discussion question, in the same order.`
            : `The last attempt returned a different number of model answers from discussion questions. Return the same number of items in both arrays, one answer for each question, in the same order. Count them before you answer.`,
          ``,
        ].join("\n")
      : "";

  const userPrompt = [
    `# Section regeneration task`,
    ``,
    `Regenerate **${section}** only.`,
    ``,
    `**Learning objective:** ${input.learningObjective}`,
    `**Difficulty:** ${input.difficulty}`,
    `**Must-cover concepts:** ${input.mustCoverConcepts.join(", ") || "(none)"}`,
    ``,
    `## Instruction`,
    sectionInstructions,
    noteBlock,
    missingBlock,
    answerBlock,
    countBlock,
    `## Discipline grounding`,
    retrieval.groundingText,
    ``,
    `## Current case content (for context only, do not modify other sections)`,
    `### Scenario`,
    currentContent.scenario,
    ``,
    `### Discussion questions`,
    currentContent.discussionQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    ``,
    `### Model answers`,
    currentContent.modelAnswers.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    ``,
    `### Rubric`,
    currentContent.rubric,
    ``,
    `Output only the field(s) for the regenerated section.`,
  ].join("\n");

  const { object } = await generateObject({
    model: getGenerationModel(),
    schema: SectionOutputSchema,
    system: pack.systemPrompt,
    prompt: userPrompt,
    temperature: 0.8,
    maxTokens: options.maxTokens,
  });

  // Filter to only the requested section so we never accidentally overwrite
  // something the editor was hand-tuning.
  const result: Partial<CaseContent> = {};
  if (section === "scenario" && object.scenario) {
    result.scenario = object.scenario;
  } else if (section === "discussionQuestions") {
    if (object.discussionQuestions) result.discussionQuestions = object.discussionQuestions;
    if (object.modelAnswers) result.modelAnswers = object.modelAnswers;
  } else if (section === "modelAnswers" && object.modelAnswers) {
    result.modelAnswers = object.modelAnswers;
  } else if (section === "rubric" && object.rubric) {
    result.rubric = object.rubric;
  }
  return { patch: normalizeOutput(result), provenance: retrieval.provenance };
}
