import {
  pgTable,
  text,
  integer,
  serial,
  timestamp,
  primaryKey,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// Auth.js (NextAuth v5) tables. There is a single instructor (role='instructor').
// Schema follows the Auth.js Drizzle adapter contract.

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  role: text("role").notNull().default("instructor"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (acc) => [primaryKey({ columns: [acc.provider, acc.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

// PersCase domain model

// A master case authored by the instructor. Personalised variants for each
// student are spawned from this record (see `caseVariants`).
export const cases = pgTable(
  "cases",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    instructorId: text("instructor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    discipline: text("discipline").notNull(), // 'finance' | 'marketing' | 'social_work'
    learningObjective: text("learning_objective").notNull(),
    difficulty: text("difficulty").notNull(), // 'novice' | 'intermediate' | 'advanced'
    mustCoverConcepts: jsonb("must_cover_concepts").notNull(), // string[]
    targetLearnerProfile: jsonb("target_learner_profile").notNull(), // { industry, role, priorKnowledge }
    contentJson: jsonb("content_json"), // { schemaVersion: 1, scenario, discussionQuestions[], modelAnswers[], rubric }
    phasesJson: jsonb("phases_json").notNull(), // PhaseDefinition[] copied from discipline pack at creation
    currentPhaseId: text("current_phase_id"), // null until released
    status: text("status").notNull().default("draft"), // 'draft' | 'generating' | 'editing' | 'approved' | 'released'
    authoringStartedAt: timestamp("authoring_started_at", { mode: "date" }).notNull().defaultNow(),
    authoringApprovedAt: timestamp("authoring_approved_at", { mode: "date" }),
    authoringSecondsLogged: integer("authoring_seconds_logged"),
    regenerationCount: integer("regeneration_count").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (c) => [
    index("cases_instructor_id_idx").on(c.instructorId),
    index("cases_discipline_idx").on(c.discipline),
    index("cases_status_idx").on(c.status),
  ],
);

// A personalised variant of a master case generated for one student.
// The unique URL `/case/[inviteToken]` resolves to this row.
export const caseVariants = pgTable(
  "case_variants",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    learnerProfileJson: jsonb("learner_profile_json").notNull(), // { displayName?, industry, role, priorKnowledge }
    contentJson: jsonb("content_json").notNull(), // personalised case (LLM-varied surface details)
    inviteToken: text("invite_token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    firstViewedAt: timestamp("first_viewed_at", { mode: "date" }),
    lastViewedAt: timestamp("last_viewed_at", { mode: "date" }),
    viewCount: integer("view_count").notNull().default(0),
  },
  (cv) => [index("variants_case_id_idx").on(cv.caseId)],
);

// Student responses per (variant, phase, activityType). Upserted on each
// auto-save. contentJson is `{ items: string[] }` for clarifying_questions
// and `{ text: string }` for notes.
export const studentResponses = pgTable(
  "student_responses",
  {
    id: serial("id").primaryKey(),
    variantId: text("variant_id").notNull().references(() => caseVariants.id, { onDelete: "cascade" }),
    phaseId: text("phase_id").notNull(),
    activityType: text("activity_type").notNull(), // 'clarifying_questions' | 'notes'
    contentJson: jsonb("content_json").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (sr) => [
    index("responses_variant_id_idx").on(sr.variantId),
    index("responses_variant_phase_idx").on(sr.variantId, sr.phaseId),
  ],
);

// Append-only event log driving the analytics dashboard and authoring-time
// telemetry. eventType ∈ { 'created', 'generation_started',
// 'generation_completed', 'section_regenerated', 'edit_saved', 'approved',
// 'released', 'phase_advanced', 'variant_spawned', 'variant_viewed',
// 'response_saved' }.
export const caseEvents = pgTable(
  "case_events",
  {
    id: serial("id").primaryKey(),
    timestampIso: text("timestamp_iso").notNull(),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    variantId: text("variant_id").references(() => caseVariants.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata"),
  },
  (e) => [
    index("events_case_id_idx").on(e.caseId),
    index("events_event_type_idx").on(e.eventType),
    index("events_timestamp_idx").on(e.timestampIso),
  ],
);

// Cached contrastive-view result for one case: the two arms that are generated
// on demand (plain unstructured LLM, and structured generation with retrieval
// switched off). The third arm shown in the UI is the case's own approved draft,
// which is read from `cases.contentJson` and never regenerated here. One row per
// case; a re-run overwrites it.
export const caseComparisons = pgTable(
  "case_comparisons",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    caseId: text("case_id")
      .notNull()
      .unique()
      .references(() => cases.id, { onDelete: "cascade" }),
    // Arm 1: free-text case from a single unstructured prompt.
    plainText: text("plain_text").notNull(),
    // Arm 2: structured generation output (GenerationOutput shape).
    structuredJson: jsonb("structured_json").notNull(),
    // Provenance recorded for arm 2, kept so the grounding column can state
    // plainly that no passages were retrieved for it.
    structuredProvenance: jsonb("structured_provenance").notNull(), // string[]
    // Provider and model the two arms were generated with, so a cached row is
    // interpretable later.
    modelId: text("model_id").notNull(),
    generatedAt: timestamp("generated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (cc) => [index("comparisons_case_id_idx").on(cc.caseId)],
);
