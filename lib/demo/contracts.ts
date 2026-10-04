// Request schemas and response types of the public demo routes (/api/demo/*).
// The demo pages build against these types; the routes validate against the
// schemas. Nothing here touches the database or a model.
import { z } from "zod";
import {
  CaseContentSchema,
  GenerationOutputSchema,
  type CaseContent,
  type CaseSection,
  type GenerationOutput,
} from "@/lib/generation/schema";
import type { ArmSignals } from "@/lib/generation/compare";
import type { ConceptCoverageReport } from "@/lib/generation/generate-case";
import type { Assessment } from "@/lib/generation/assess-attempt";
import type { HintLevelNumber } from "@/lib/generation/hint-levels";
import type { RetrievalStatus, RejectionReason } from "@/lib/retrieval/embedding-provider";

// Units each demo request costs, charged by lib/demo/guards.ts. A full case
// generation or a personalisation is one large structured call; a hint, a
// feedback reading or a plain reply is one small call. The "retrieve" arm of
// /api/demo/generate makes one embedding call and costs 1, so that it cannot
// be used to bypass the budgets; the "signals" and "budget" arms make no model
// call and cost nothing. The "regenerate" arm rewrites one section of the
// PersCase draft in one structured call and costs 2, as a generation does.
// Kept here rather than in guards.ts so that the page, which checks the
// allowance before it starts a step, reads the same numbers.
export const DEMO_COST = {
  generate: 2,
  personalise: 2,
  student: 1,
  retrieve: 1,
  regenerate: 2,
} as const;

// The brief, with the same field limits as the instructor's create-case route,
// except that the demo takes at most four must-cover concepts.
export const DemoBriefSchema = z.object({
  discipline: z.enum(["finance", "marketing", "social_work"]),
  learningObjective: z.string().min(10).max(2000),
  difficulty: z.enum(["novice", "intermediate", "advanced"]),
  mustCoverConcepts: z.array(z.string().min(1).max(80)).max(4),
  targetLearnerProfile: z.object({
    industry: z.string().min(1).max(120),
    role: z.string().min(1).max(120),
    priorKnowledge: z.string().min(1).max(120),
  }),
});

export type DemoBrief = z.infer<typeof DemoBriefSchema>;

// The four text fields, for the signals arm. A structured arm's output or a
// CaseContent both pass; anything else on the object is ignored.
const CaseTextFieldsSchema = z.object({
  scenario: z.string().max(20000),
  discussionQuestions: z.array(z.string().max(4000)).max(10),
  modelAnswers: z.array(z.string().max(8000)).max(10),
  rubric: z.string().max(10000),
});

const ProvenanceSchema = z.array(z.string().max(300)).max(20);

// POST /api/demo/generate

export const DemoGenerateRequestSchema = z.discriminatedUnion("arm", [
  z.object({ arm: z.literal("plain"), brief: DemoBriefSchema }),
  z.object({ arm: z.literal("structured"), brief: DemoBriefSchema }),
  // With `provenance` (from the retrieve arm), generation uses exactly the
  // notes it names instead of retrieving again, so that the trace the page
  // showed first and the notes the model received are the same set.
  z.object({
    arm: z.literal("perscase"),
    brief: DemoBriefSchema,
    provenance: ProvenanceSchema.optional(),
  }),
  // No model call, 1 unit: the retrieval preview only (one embedding call),
  // so that the page can show the trace before generation starts.
  z.object({ arm: z.literal("retrieve"), brief: DemoBriefSchema }),
  // One structured call, 2 units: the instructor's remedy for a flagged
  // concept. Regenerates one section of the PersCase draft with the missing
  // concepts named, grounded in the notes the draft was generated from
  // (`provenance`, from the perscase arm), and returns the whole draft with
  // that section replaced and the readings taken again.
  z.object({
    arm: z.literal("regenerate"),
    brief: DemoBriefSchema,
    content: GenerationOutputSchema,
    provenance: ProvenanceSchema,
    section: z.enum(["scenario", "discussionQuestions", "modelAnswers", "rubric"]),
    missingConcepts: z.array(z.string().min(1).max(80)).min(1).max(4),
  }),
  // No model call and no cost: this visitor's remaining allowance, read
  // without charging anything, so that the page can refuse a step that would
  // not fit before it sends any part of it.
  z.object({ arm: z.literal("budget") }),
  // No model call and no cost: recomputes a baseline's readings once the
  // PersCase arm's provenance is known. Send exactly one of `text` (plain arm)
  // or `content` (structured arm).
  z.object({
    arm: z.literal("signals"),
    brief: DemoBriefSchema,
    provenance: ProvenanceSchema,
    text: z.string().max(40000).optional(),
    content: CaseTextFieldsSchema.optional(),
  }),
]).superRefine((b, ctx) => {
  if (b.arm === "signals" && (b.text === undefined) === (b.content === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["text"],
      message: "Send exactly one of text or content.",
    });
  }
});

export type DemoGenerateRequest = z.infer<typeof DemoGenerateRequestSchema>;

export interface RetrievalTraceNote {
  id: string;
  title: string;
  score: number;
  // Below the weak-match line (RETRIEVAL_WEAK_SCORE), as the Retrieval step marks it.
  weakMatch: boolean;
  caseDesign: boolean;
  // The start of the note's text on one line: its first 140 characters, with
  // an ellipsis when the note is longer (lib/demo/retrieval-trace.ts).
  excerpt: string;
}

export interface RetrievalTrace {
  notes: RetrievalTraceNote[];
  // The best-scoring note that was left out, with the rule that left it out.
  leftOut: {
    id: string;
    title: string;
    score: number;
    rule: RejectionReason;
  } | null;
  // Must-cover concepts that none of the retrieved notes mentions, by the
  // Retrieval step's own lexical check (lib/retrieval/concept-notes.ts).
  unmentionedConcepts: string[];
  // "ok", "corpus-not-embedded", or "retrieval-off" when RETRIEVAL_PROVIDER is
  // prompt-pack. In the last two cases `notes` is empty and generation used
  // the discipline pack only.
  status: Exclude<RetrievalStatus, "embedding-failed"> | "retrieval-off";
  minScore: number;
  weakScore: number;
  budget: number;
}

interface Timed {
  modelId: string;
  elapsedMs: number;
}

export type DemoGenerateResponse =
  | ({
      arm: "plain";
      kind: "text";
      text: string;
      provenance: [];
      retrieval: null;
      signals: ArmSignals;
    } & Timed)
  | ({
      arm: "structured";
      kind: "structured";
      content: GenerationOutput;
      provenance: [];
      retrieval: null;
      signals: ArmSignals;
    } & Timed)
  | ({
      arm: "perscase";
      kind: "structured";
      content: GenerationOutput;
      provenance: string[];
      retrieval: RetrievalTrace;
      signals: ArmSignals;
      // Set when every attempt failed on the scripted preset's brief and the
      // arm returned the stored draft of an earlier run of that brief
      // (lib/demo/stored-draft.ts). `signals` are then taken on the stored
      // draft against `provenance`, the notes of this request, and
      // `failedAttempts` is how many attempts failed just now.
      stored?: true;
      storedFrom?: string;
      failedAttempts?: number;
    } & Timed)
  | { arm: "signals"; signals: ArmSignals }
  | DemoRegenerateResponse
  | DemoBudgetResponse
  // The retrieval trace and the provenance to send back with arm "perscase".
  | { arm: "retrieve"; retrieval: RetrievalTrace; provenance: string[] };

// The "regenerate" arm: the whole draft with `section` replaced, and the
// readings of the new draft against the same notes.
export type DemoRegenerateResponse = {
  arm: "regenerate";
  section: CaseSection;
  content: GenerationOutput;
  signals: ArmSignals;
} & Timed;

// The "budget" arm. `remaining` is null when the per-visitor limit is switched
// off (DEMO_UNITS_PER_CLIENT_PER_10MIN=0), and is otherwise the smaller of the
// visitor's own units and the instance's hourly units left. `retryAfterSec` is
// the wait until the binding budget refills, or null when nothing is spent.
export interface DemoBudgetResponse {
  arm: "budget";
  remaining: number | null;
  perClientLimit: number;
  retryAfterSec: number | null;
}

// POST /api/demo/personalise

export const DemoPersonaliseRequestSchema = z.object({
  arm: z.enum(["plain", "perscase"]),
  brief: DemoBriefSchema,
  // A structured case, or the free text of a plain draft. Only the plain arm
  // takes free text; the PersCase arm rewrites fields and needs a case.
  base: z.union([CaseContentSchema, z.object({ text: z.string().min(1).max(20000) })]),
  team: z.object({
    displayName: z.string().min(1).max(120),
    industry: z.string().min(1).max(120),
    role: z.string().min(1).max(120),
  }),
}).superRefine((b, ctx) => {
  if (b.arm === "perscase" && "text" in b.base) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["base"],
      message: "The PersCase arm takes a structured case as its base.",
    });
  }
});

export type DemoPersonaliseRequest = z.infer<typeof DemoPersonaliseRequestSchema>;

interface PersonaliseReadings {
  coverage: ConceptCoverageReport;
  // Scenario sentences of the variant that are not in the base, by the same
  // reading as the instructor's variant cards (lib/text/diff-sentences.ts).
  // For a free-text variant the whole text is compared with the whole draft.
  differingSentences: { differing: number; total: number };
}

export type DemoPersonaliseResponse =
  | ({ arm: "plain"; kind: "text"; text: string } & PersonaliseReadings & Timed)
  | ({ arm: "plain" | "perscase"; kind: "structured"; content: CaseContent } & PersonaliseReadings & Timed);

// POST /api/demo/student

export const DEMO_MAX_HINTS = 3;

export const DemoStudentRequestSchema = z.object({
  arm: z.enum(["plain", "perscase"]),
  mode: z.enum(["hint", "feedback"]),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("seed"), id: z.string().min(1).max(80) }),
    z.object({ kind: z.literal("content"), content: CaseContentSchema }),
  ]),
  phaseId: z.string().min(1).max(80).optional(),
  // PersCase hint only: the 0-based index of the discussion question the
  // message names ("question 2" is 1). The route then gives the hint no phase
  // and tells the hint writer which question is asked; an index past the
  // case's questions is ignored.
  questionIndex: z.number().int().min(0).max(9).optional(),
  message: z.string().min(1).max(4000),
  previousHints: z.array(z.string().max(2000)).max(DEMO_MAX_HINTS).optional(),
});

export type DemoStudentRequest = z.infer<typeof DemoStudentRequestSchema>;

// No model call and no cost: a seeded case's scenario, its discussion
// questions and the task of the phase the student scene answers, so that the
// page can show the questions before anything is sent.
export const DemoStudentCaseRequestSchema = z.object({
  arm: z.literal("case"),
  source: z.object({ kind: z.literal("seed"), id: z.string().min(1).max(80) }),
  phaseId: z.string().min(1).max(80).optional(),
});

export interface DemoStudentCaseResponse {
  arm: "case";
  caseText: string;
  discussionQuestions: string[];
  // The phase's task as the student page shows it, or null when the case has
  // no such phase.
  phasePrompt: { title: string; prompt: string } | null;
}

// Set on every response for a seeded case: the case's scenario, which the page
// does not otherwise hold, for the check for figures copied from the case.
interface SeedCaseText {
  caseText?: string;
}

// A PersCase hint carries the rung of the ladder it sits on (HINT_LEVELS in
// lib/generation/hint-levels.ts): its number and its name. An assessment
// carries `overall` (the judgement against the criteria) and `nextStep` (one
// thing to do next).
export type DemoStudentResponse =
  | ({
      arm: "perscase";
      mode: "hint";
      hint: string;
      level: HintLevelNumber;
      levelName: string;
      index: number;
      total: number;
    } & Timed & SeedCaseText)
  | ({ arm: "perscase"; mode: "feedback"; assessment: Assessment } & Timed & SeedCaseText)
  // Too short to rate (no model call) or rated false by the model.
  | ({ arm: "perscase"; mode: "feedback"; notRated: { reason: string } } & Timed & SeedCaseText)
  | ({ arm: "plain"; mode: "hint" | "feedback"; text: string } & Timed & SeedCaseText);

// Error body of every demo route. `retryAfterSec` is set on rate_limited only.
export interface DemoErrorResponse {
  error:
    | "invalid"
    | "too_large"
    | "demo_paused"
    | "daily_limit"
    | "rate_limited"
    | "hint_limit"
    | "not_found"
    | "invalid_content"
    | "retrieval_failed"
    | "model_failed";
  message?: string;
  issues?: unknown;
  retryAfterSec?: number;
}
