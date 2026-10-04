import { z } from "zod";

// Versioned case content. Bump schemaVersion when the shape changes; existing
// rows in cases.contentJson must be migrated.

// Optional glossary of key terms, surfaced to students (e.g. for English-as-an-
// additional-language learners). Optional so cases authored before glossaries
// existed still validate.
export const GlossaryEntrySchema = z.object({
  term: z.string().min(1).max(80),
  definition: z.string().min(1).max(400),
});

export const CaseContentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  scenario: z.string().min(200, "Scenario must be at least ~200 characters"),
  discussionQuestions: z.array(z.string().min(10)).min(3).max(8),
  modelAnswers: z.array(z.string().min(20)).min(3).max(8),
  rubric: z.string().min(50),
  glossary: z.array(GlossaryEntrySchema).max(10).optional(),
});

export type CaseContent = z.infer<typeof CaseContentSchema>;

// Schema used by generateObject. We omit schemaVersion (default-injected
// after parse) so the LLM doesn't have to emit it.
export const GenerationOutputSchema = z.object({
  scenario: z.string().describe("350-600 word scenario in Markdown"),
  discussionQuestions: z
    .array(z.string())
    .min(4)
    .max(6)
    .describe("4-6 open-ended discussion questions"),
  modelAnswers: z
    .array(z.string())
    .min(4)
    .max(6)
    .describe("Model answers, matched 1:1 to discussion questions"),
  rubric: z
    .string()
    .describe(
      "Teaching rubric with 4 weighted criteria, each with a single-sentence 'what excellent looks like'",
    ),
  glossary: z
    .array(GlossaryEntrySchema)
    .min(3)
    .max(8)
    .describe(
      "3-8 key domain terms used in the case, each with a one-sentence plain-language definition, to support learners reading in a second language",
    ),
});

export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

// The four text fields shared by GenerationOutput and CaseContent. Coverage,
// grounding, and difficulty checks read only these, so they accept either shape
// regardless of whether a glossary is present.
export interface CaseTextFields {
  scenario: string;
  discussionQuestions: string[];
  modelAnswers: string[];
  rubric: string;
}

export type CaseSection = "scenario" | "discussionQuestions" | "modelAnswers" | "rubric";

export const CASE_SECTIONS: CaseSection[] = [
  "scenario",
  "discussionQuestions",
  "modelAnswers",
  "rubric",
];
