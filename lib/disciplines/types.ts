export type DisciplineId = "finance" | "marketing" | "social_work";

// Attached to every discipline's system prompt, so it reaches the full
// generation, a section regeneration and a team variant alike. The corpus notes
// are jurisdiction-neutral, so a draft that names a statute, a duty or an
// agency of its own reads as authoritative when nothing behind it is.
export const LEGAL_GROUNDING_RULE =
  "Sources for law and policy: state a law, a regulation, a reporting duty, or a named agency only where a retrieved note supports it or the instructor's brief names it. Where the case needs one and neither does, write that the applicable local statute or policy must be checked, and do not invent one.";

export type ActivityType = "clarifying_questions" | "notes" | "answer_attempt";

export type Difficulty = "novice" | "intermediate" | "advanced";

export interface FewShotExemplar {
  title: string;
  scenario: string;
  discussionQuestions: string[];
  rubric: string;
}

export interface PhaseDefinition {
  id: string;
  order: number;
  label: string;
  studentTitle: string;
  studentPrompt: string;
  activities: ActivityType[];
  disciplineHint?: string;
  // Optional suggested working time in minutes, shown to students as guidance
  // for a timed exercise. Advisory only: it does not gate or auto-advance.
  suggestedMinutes?: number;
}

export interface DifficultyHints {
  novice: string;
  intermediate: string;
  advanced: string;
}

export interface DisciplinePack {
  id: DisciplineId;
  label: string;
  blurb: string;
  // Cases in this discipline carry a quantitative core (numbers, calculations).
  // When true, the editor reminds the instructor that generated figures are
  // model-produced and unverified, and should be checked before approval.
  quantitative?: boolean;
  systemPrompt: string;
  styleNotes: string[];
  vocabulary: string[];
  difficultyHints: DifficultyHints;
  fewShots: FewShotExemplar[];
  rubricTemplate: string;
  // One short example, in this discipline's own terms, of how a team whose
  // practice context differs from the master case's meets the same situation
  // from outside. Given to the variant prompt so that the organisation facing
  // the decision stays put and only the protagonist's standing changes.
  variantEntryExample: string;
  // Placeholder text for the two "note to the model" boxes, so that the example
  // an instructor reads is in the discipline they are working in.
  regenerateNoteExample: string;
  redraftNoteExample: string;
  // Shown in the editor beside the approval control. Only disciplines whose
  // drafts can state a legal duty carry one.
  approvalReminder?: string;
  // Checks the feedback prompt applies to a student's answer before the rubric,
  // one sentence each. An answer that triggers one gets a line in the
  // assessment's flags, which the views show above the band. They cover errors
  // a rubric criterion does not name and a band can hide (a false legal duty, a
  // figure the scenario cannot support). They flag; they do not recompute or
  // correct.
  feedbackChecks: string[];
  defaultPhases: PhaseDefinition[];
}

export interface CaseInput {
  discipline: DisciplineId;
  learningObjective: string;
  difficulty: Difficulty;
  mustCoverConcepts: string[];
  targetLearnerProfile: {
    industry: string;
    role: string;
    priorKnowledge: string;
  };
}
