// The demo's "plain" baselines for personalisation and for the student tools.
// Each is one model call with a deliberately plain prompt, standing for what a
// general chatbot would be asked. They carry none of PersCase's rules, and the
// prompts are kept that way on purpose; do not add rules here.
import { generateObject, generateText } from "ai";
import { getGenerationModel } from "@/lib/llm/client";
import { normalizeOutput } from "@/lib/generation/generate-case";
import { GenerationOutputSchema, type CaseContent } from "@/lib/generation/schema";

export const PLAIN_PERSONALISE_SYSTEM = "You adapt teaching case studies.";
export const PLAIN_STUDENT_SYSTEM = "Answer the student plainly in prose. No markdown headings.";

export async function plainPersonalise(
  base: CaseContent,
  team: { industry: string; role: string },
  maxTokens: number,
): Promise<CaseContent> {
  const prompt = [
    "Scenario:",
    base.scenario,
    "",
    "Discussion questions:",
    base.discussionQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    "",
    "Model answers:",
    base.modelAnswers.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    "",
    "Rubric:",
    base.rubric,
    "",
    "Glossary:",
    (base.glossary ?? []).map((g) => `${g.term}: ${g.definition}`).join("\n") || "(none)",
    "",
    `Adapt this case for a team of ${team.role} working in ${team.industry}. Return the adapted case in the same structure.`,
  ].join("\n");

  const { object } = await generateObject({
    model: getGenerationModel(),
    schema: GenerationOutputSchema,
    system: PLAIN_PERSONALISE_SYSTEM,
    prompt,
    maxTokens,
  });
  return { schemaVersion: 1, ...normalizeOutput(object) };
}

// A plain draft is free text, so its variant is asked for as free text too:
// the draft, then one sentence of instruction, and nothing else.
export async function plainPersonaliseText(
  text: string,
  team: { industry: string; role: string },
  maxTokens: number,
): Promise<string> {
  const { text: out } = await generateText({
    model: getGenerationModel(),
    system: PLAIN_PERSONALISE_SYSTEM,
    prompt: [
      text,
      "",
      `Adapt this case for a team of ${team.role} working in ${team.industry}. Keep it a complete teaching case.`,
    ].join("\n"),
    maxTokens,
  });
  return out.trim();
}

export interface PlainStudentPhase {
  label: string;
  prompt: string;
}

// The student sees the scenario, the questions and the phase task, so the
// plain reply is given the same and nothing more: no model answers, no rubric.
export function buildPlainStudentPrompt(
  content: Pick<CaseContent, "scenario" | "discussionQuestions">,
  phase: PlainStudentPhase | undefined,
  message: string,
): string {
  return [
    "Case scenario:",
    content.scenario,
    "",
    "Discussion questions:",
    content.discussionQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    "",
    ...(phase ? [`Current task (${phase.label}):`, phase.prompt, ""] : []),
    `Student: ${message}`,
  ].join("\n");
}

export async function plainStudentReply(
  content: Pick<CaseContent, "scenario" | "discussionQuestions">,
  phase: PlainStudentPhase | undefined,
  message: string,
  maxTokens: number,
): Promise<string> {
  const { text } = await generateText({
    model: getGenerationModel(),
    system: PLAIN_STUDENT_SYSTEM,
    prompt: buildPlainStudentPrompt(content, phase, message),
    maxTokens,
  });
  return text.trim();
}
