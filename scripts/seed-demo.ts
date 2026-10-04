// Seed the example cases of the demo, or remove them again with `--clean`.
// The case text is the generated content in demo/sample-outputs with the
// instructor edits listed in INSTRUCTOR_EDITS below applied to it: generate,
// edit, approve. Every seeded row has an id starting with "seed-". Cleanup
// deletes by that prefix and nothing else, and the API refuses to change those
// rows on the public demo. Student activity (views, responses) is synthetic,
// spread over the last 7 days so that the analytics charts have data; the
// analytics page says so.
//
// One released case is seeded per discipline (finance, marketing, social work),
// each with at least two team variants. The contrastive view of each is filled
// from the committed baselines in demo/sample-comparisons, and seeding makes no
// model call. Pass --no-comparisons to leave that cache empty, or
// --regenerate-comparisons to generate the baselines again and rewrite those
// files.
//
// The seeded baselines are pinned because the readings in
// demo/comparison-readings.json are read off them. Regenerating them changes
// those numbers.
//
// It rewrites whatever database POSTGRES_URL points at, so it refuses to run
// against a host other than localhost unless --yes-shared-database is passed.
// Either way it first prints the host and what it would delete and insert.
//
//   pnpm tsx scripts/seed-demo.ts                           # insert
//   pnpm tsx scripts/seed-demo.ts --no-comparisons          # insert, skip compare cache
//   pnpm tsx scripts/seed-demo.ts --regenerate-comparisons  # new baselines, rewrite the files
//   pnpm tsx scripts/seed-demo.ts --clean                   # remove
//   pnpm tsx scripts/seed-demo.ts --yes-shared-database     # allow a non-local host

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { db } from "../lib/db/client";
import {
  users,
  cases,
  caseVariants,
  caseEvents,
  studentResponses,
  caseComparisons,
} from "../lib/db/schema";
import { getDisciplinePack } from "../lib/disciplines";
import type { CaseInput, DisciplineId } from "../lib/disciplines/types";
import {
  generatePlainCase,
  generateStructuredNoRetrieval,
} from "../lib/generation/compare";
import { checkConceptCoverage } from "../lib/generation/generate-case";
import { groundingUtilisation } from "../lib/retrieval/grounding";
import { resultProvenance } from "./result-provenance";
import type {
  CaseSection,
  CaseTextFields,
  GenerationOutput,
} from "../lib/generation/schema";

loadEnv({ path: ".env.local" });
loadEnv();

const ADMIN_ID = "admin";
const DRAFT_CASE_ID = "seed-case-finance-draft";
const CASE_IDS = [
  "seed-case-finance",
  "seed-case-marketing",
  "seed-case-social-work",
  DRAFT_CASE_ID,
];
const read = (f: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "demo/sample-outputs", f), "utf8"));
const readVariant = (f: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "demo/sample-variants", f), "utf8"));

const now = Date.now();
const dayMs = 86400_000;
function isoDaysAgo(days: number, hour = 12): string {
  const dt = new Date(now - days * dayMs);
  dt.setHours(hour, 0, 0, 0);
  return dt.toISOString();
}

// Instructor edits
//
// demo/sample-outputs holds the raw generations and is never changed. The
// seeded case is the raw draft with a short, named list of edits applied before
// approval. Each edit below records what was changed and why, and each is
// logged as an edit_saved event between generation and approval, which is where
// the provenance record lists it.
//
// The edits are transformations rather than replacement files because
// scripts/generate-demo-variants.ts applies the same list before personalising.
// A team variant is written from the edited master and cannot carry a miss the
// master no longer has. The committed variant files are already edited, and
// this list is applied here to the master only.

interface SeedContent extends CaseTextFields {
  glossary?: { term: string; definition: string }[];
}

interface InstructorEdit {
  section: CaseSection;
  note: string;
  apply: (c: SeedContent) => SeedContent;
}

function applyInstructorEdits(content: SeedContent, edits: InstructorEdit[]) {
  let out = content;
  for (const e of edits) out = e.apply(out);
  return out;
}

// Scenario normalisation
//
// A stray or whole-sentence bold marker in a raw generation renders as literal
// asterisks on the student page. The raw files stay as generated, so the rule
// is applied here to every seeded scenario a student can open, released master
// and team variant, when it is inserted (after the instructor edits). The
// unapproved draft case stays raw, as seedDraftCase explains:
//   1. a "**" pair that wraps a whole sentence ending in "?" is removed, and
//      the sentence is kept;
//   2. on a line with an odd number of "**" markers, the unmatched last one is
//      removed.
// No word is added or dropped. scripts/fix-seed-scenario.ts applies the same
// function to rows already in the database.
const WHOLE_QUESTION_BOLD = /(^|\s)\*\*([A-Z][^*\n]*\?)\*\*(?=\s|$)/gm;

function normaliseSeedScenario(scenario: string): string {
  const unwrapped = scenario.replace(
    WHOLE_QUESTION_BOLD,
    (_m, lead: string, sentence: string) => `${lead}${sentence}`,
  );
  return unwrapped
    .split("\n")
    .map((line) => {
      const markers = line.split("**").length - 1;
      if (markers % 2 === 0) return line;
      const i = line.lastIndexOf("**");
      return line.slice(0, i) + line.slice(i + 2);
    })
    .join("\n");
}

function normaliseSeedContent<T extends { scenario?: unknown }>(content: T): T {
  return typeof content.scenario === "string"
    ? { ...content, scenario: normaliseSeedScenario(content.scenario) }
    : content;
}

function trimNumber(n: number): string {
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

// The DDM calculations in the finance drafts discount the dividend just paid.
// The retrieved note fin-ddm says the numerator is next year's dividend, so
// every calculation is rewritten as D1 = D0(1 + g) and the arithmetic redone.
// Figures quoted again in later sentences ("the increase from X to Y") are
// moved with it. The replacement map never maps one answer's old figure onto
// another's, so the substitutions cannot chain. The number groups stop before a
// sentence-ending full stop, so the figure looked for again later is "21.43"
// rather than "21.43.".
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const DDM_CALCULATION = new RegExp(
  `V = (?:D / \\(r - g\\) = )?${NUM} / \\(${NUM} - ${NUM}\\) = ${NUM}`,
  "g",
);

function nextYearDividendCalcs(answers: string[]): string[] {
  const moved = new Map<string, string>();
  const rewritten = answers.map((a) =>
    a.replace(DDM_CALCULATION, (_m, d0: string, r: string, g: string, v: string) => {
      const d1 = Number(d0) * (1 + Number(g));
      const value = d1 / (Number(r) - Number(g));
      moved.set(v, value.toFixed(2));
      return `V = D1 / (r - g) = ${trimNumber(d1)} / (${r} - ${g}) = ${value.toFixed(2)}`;
    }),
  );
  return rewritten.map((a) => {
    let s = a;
    for (const [before, after] of moved) s = s.split(before).join(after);
    return s;
  });
}

const TERMINAL_VALUE_PARAGRAPH =
  "Note the horizon you are working with. The single-stage DDM has no explicit forecast period, so the figure it returns is a terminal value: it prices every future dividend at once under one permanent growth assumption. Treat the long-term growth rate you choose as a statement about the steady state, not about the next three years.";

const FINANCE_EDITS: InstructorEdit[] = [
  {
    section: "scenario",
    note: "Added a paragraph naming the terminal value. A single-stage DDM is all terminal value, and the retrieved note fin-terminal-value says so, but the draft never used the term, so the case failed its own must-cover check.",
    apply: (c) => ({
      ...c,
      scenario: c.scenario.replace(
        /\n\nYou (?:realise|realize)/,
        (m) => `\n\n${TERMINAL_VALUE_PARAGRAPH}${m}`,
      ),
    }),
  },
  {
    section: "discussionQuestions",
    note: "Pointed question 2 at the terminal value, so the concept is examined in the task rather than mentioned once in the scenario.",
    apply: (c) => ({
      ...c,
      discussionQuestions: c.discussionQuestions.map((q) =>
        q.replace(
          "What does this sensitivity analysis reveal about the growth assumptions?",
          "What does this sensitivity analysis reveal about the growth assumption embedded in the terminal value?",
        ),
      ),
    }),
  },
  {
    section: "modelAnswers",
    note: "Corrected every DDM calculation to use next year's dividend, D1 = D0(1 + g), which is what the retrieved note fin-ddm specifies; redid the arithmetic and the figures quoted downstream, and said in answer 1 which dividend the numerator is.",
    apply: (c) => ({
      ...c,
      modelAnswers: nextYearDividendCalcs(c.modelAnswers).map((a, i) =>
        i === 0
          ? `${a} The numerator is next year's dividend, D1 = D0(1 + g); discounting the dividend just paid understates the value.`
          : a,
      ),
    }),
  },
  {
    section: "modelAnswers",
    note: "Added a sentence to answer 2 on why the growth rate moves a terminal value more than the discount rate does at these levels, to match the rewritten question.",
    apply: (c) => ({
      ...c,
      modelAnswers: c.modelAnswers.map((a, i) =>
        i === 1
          ? `${a} Because the whole figure is a terminal value, the growth rate compounds forever inside it, so a one-point change in growth moves the answer further than a one-point change in the cost of equity at these levels.`
          : a,
      ),
    }),
  },
];

// The marketing draft covered all four of its concepts as generated, and this
// list is empty. It is kept for symmetry with the other two disciplines.
const MARKETING_EDITS: InstructorEdit[] = [];

const DUAL_RELATIONSHIP_PARAGRAPH =
  "Your placement supervisor raises one more thing before you start. The assisted living facility Sarah favours is run by an agency where your sister-in-law manages admissions, and you attend the same parish as the Thompsons. That is a dual relationship risk, and the agency expects it declared in writing and managed before any recommendation is written, not mentioned afterwards.";

const SOCIAL_WORK_EDITS: InstructorEdit[] = [
  {
    section: "scenario",
    note: "Removed the discussion-question list the model repeated at the end of the scenario; the questions have their own section and the student page rendered them twice.",
    apply: (c) => ({
      ...c,
      scenario: c.scenario.replace(/\n+\*\*Discussion questions:\*\*[\s\S]*$/, "").trim(),
    }),
  },
  {
    section: "scenario",
    note: "Named the least-restrictive setting as the standard the recommendation is held to. The draft described it loosely as an approach, which left the concept undetectable and, more to the point, left students unclear what they were being asked to justify.",
    apply: (c) => ({
      ...c,
      scenario: c.scenario.replace(
        /The agency.s policy emphasizes a least-restrictive approach to eldercare, which prioritizes home care wherever feasible\./,
        "The agency's policy requires you to recommend the least-restrictive setting that meets the assessed need, which in practice means home care with support wherever that is workable.",
      ),
    }),
  },
  {
    section: "scenario",
    note: "Added the conflict of interest the placement supervisor flagged, so the dual relationship risk is something the student has to handle rather than a term in the glossary.",
    apply: (c) => ({ ...c, scenario: `${c.scenario}\n\n${DUAL_RELATIONSHIP_PARAGRAPH}` }),
  },
  {
    section: "discussionQuestions",
    note: "Rewrote question 2 to ask for a family-systems framing by name, and added a sixth question on the conflict of interest and the evidence a least-restrictive recommendation has to carry.",
    apply: (c) => ({
      ...c,
      discussionQuestions: [
        ...c.discussionQuestions.map((q, i) =>
          i === 1
            ? "Apply a family-systems framing to this case. How do the sibling roles, the extended family's involvement and Clara's own position in that system shape the preference she states, and how would you map it?"
            : q,
        ),
        "You have a personal connection to the facility Sarah prefers. How would you handle that dual relationship risk, and what does it change about the evidence your least-restrictive setting recommendation has to carry?",
      ],
    }),
  },
  {
    section: "modelAnswers",
    note: "Rewrote answer 2 in family-systems terms rather than as general remarks about family dynamics, and added the matching sixth answer.",
    apply: (c) => ({
      ...c,
      modelAnswers: [
        ...c.modelAnswers.map((a, i) =>
          i === 1
            ? "A family-systems framing reads Clara's shifting preference as a position held inside a set of relationships rather than as an isolated choice. Sarah lives nearby and carries the daily risk, which is where her push for assisted living comes from; Mark's commitment to her independence is easier to hold from another province. The siblings' extended family supplies a second layer of pressure, and Clara's own role as the one who has always held the family together makes it costly for her to state a need. Mapping the household with a genogram and an ecomap shows those alliances and the roles each person occupies, so the recommendation addresses the system that produced the disagreement rather than only the person in front of you."
            : a,
        ),
        "Declare the connection to your supervisor in writing before the assessment goes further, and record it on the file. A dual relationship risk is managed rather than wished away: disclosure, a second assessor for any recommendation involving that facility, and withdrawal from the admissions conversation. It also raises the bar for the recommendation itself. To show that a placement is the least-restrictive setting that meets Clara's assessed need, you would have to record which in-home packages were considered, what each does and does not cover, and why the remaining gap cannot be closed at home. Without that record, a recommendation that happens to favour a facility you are connected to is hard to defend.",
      ],
    }),
  },
];

interface Team {
  id: string;
  token: string;
  name: string;
  industry: string;
  role: string;
  size: number;
  views: number; // viewCount + number of variant_viewed events generated
  responses: number; // number of response_saved events generated
  // Committed personalised content, written by
  // scripts/generate-demo-variants.ts from the instructor-edited master. Every
  // seeded team has one.
  contentFile: string;
}

interface CaseCfg {
  id: string;
  discipline: DisciplineId;
  sample: string;
  regenSections: string[];
  teams: Team[];
  glossary: { term: string; definition: string }[];
  note: string; // co-instructor handoff note
  ratings: number[]; // student case ratings (1-5)
  disputes: number; // count of disputed-feedback flags
  // Instructor edits applied to the raw generation before approval. See the
  // INSTRUCTOR EDITS section below.
  edits: InstructorEdit[];
  // Leaves this case open at its last phase instead of at phase 2. The last
  // phase is the one that carries an answer box, so one seeded case shows the
  // hint and feedback controls to a visitor who advances nothing.
  openAtLastPhase?: boolean;
}

const FINANCE: CaseCfg = {
  id: "seed-case-finance",
  discipline: "finance",
  sample: "finance.json",
  regenSections: ["discussionQuestions", "rubric"],
  teams: [
    { id: "seed-f1", token: "seedretailbank01", name: "Team Alpha", industry: "retail banking", role: "junior analyst", size: 4, views: 9, responses: 4, contentFile: "finance-retail.json" },
    { id: "seed-f2", token: "seedteambeta0002", name: "Team Beta", industry: "corporate treasury", role: "treasury associate", size: 5, views: 12, responses: 3, contentFile: "finance-treasury.json" },
    { id: "seed-f3", token: "seedteamgamma003", name: "Team Gamma", industry: "credit risk", role: "credit analyst", size: 3, views: 6, responses: 2, contentFile: "finance-credit-risk.json" },
    { id: "seed-f4", token: "seedteamdelta004", name: "Team Delta", industry: "equity research", role: "research analyst", size: 4, views: 8, responses: 3, contentFile: "finance-equity-research.json" },
    { id: "seed-f5", token: "seedteamepsiln5", name: "Team Epsilon", industry: "wealth advisory", role: "portfolio adviser", size: 4, views: 4, responses: 1, contentFile: "finance-wealth-advisory.json" },
  ],
  glossary: [
    { term: "Dividend discount model (DDM)", definition: "A way to value a share as the present value of the dividends it is expected to pay." },
    { term: "Cost of equity", definition: "The return shareholders require for holding the stock, used as the discount rate." },
    { term: "Terminal growth rate", definition: "The constant rate at which dividends are assumed to grow forever after the forecast horizon." },
    { term: "Sensitivity analysis", definition: "Re-running the valuation while changing one assumption to see how much the answer moves." },
  ],
  note: "Tuned the rubric for the part-time cohort: lighter on modelling depth, heavier on the recommendation memo. Hold release for the evening section until week 6.",
  ratings: [5, 4, 5, 4, 3, 5, 4, 5],
  disputes: 1,
  edits: FINANCE_EDITS,
};

const MARKETING: CaseCfg = {
  id: "seed-case-marketing",
  discipline: "marketing",
  sample: "marketing.json",
  regenSections: ["scenario"],
  teams: [
    { id: "seed-m1", token: "seedmktconsumer1", name: "Team Indigo", industry: "consumer health marketing", role: "brand assistant", size: 4, views: 7, responses: 3, contentFile: "marketing-consumer-health.json" },
    { id: "seed-m2", token: "seedmktretail02", name: "Team Jade", industry: "retail marketing", role: "marketing associate", size: 3, views: 5, responses: 2, contentFile: "marketing-retail.json" },
    { id: "seed-m3", token: "seedmktd2c0003", name: "Team Onyx", industry: "direct-to-consumer marketing", role: "growth analyst", size: 5, views: 10, responses: 4, contentFile: "marketing-d2c.json" },
  ],
  glossary: [
    { term: "Positioning", definition: "The distinct place a brand aims to occupy in the customer's mind relative to competitors." },
    { term: "Segmentation", definition: "Dividing a market into groups of customers with similar needs so messaging can be tailored." },
    { term: "Customer acquisition cost (CAC)", definition: "The average spend needed to win one new customer." },
    { term: "Conversion rate", definition: "The share of people who take the desired action, such as buying or signing up." },
  ],
  note: "Swapped in the D2C exemplar for the Onyx team. Watch the persuasive framing and keep claims defensible.",
  ratings: [4, 5, 3, 4, 4],
  disputes: 0,
  edits: MARKETING_EDITS,
  // The one seeded case left open at its last phase.
  openAtLastPhase: true,
};

// The social work case, with two teams, the smallest configuration the tool
// supports.
const SOCIAL_WORK: CaseCfg = {
  id: "seed-case-social-work",
  discipline: "social_work",
  sample: "social-work.json",
  regenSections: ["modelAnswers"],
  teams: [
    { id: "seed-s1", token: "seedswcommunity1", name: "Team Harbour", industry: "community eldercare social work", role: "MSW-track student on placement", size: 4, views: 8, responses: 3, contentFile: "social-work-community.json" },
    { id: "seed-s2", token: "seedswhospital2", name: "Team Meridian", industry: "hospital discharge planning", role: "medical social worker", size: 3, views: 6, responses: 2, contentFile: "social-work-hospital.json" },
  ],
  glossary: [
    { term: "Capacity assessment", definition: "A structured judgement about whether a person can understand and weigh a specific decision at a specific time." },
    { term: "Family-systems framing", definition: "Reading a family as a set of relationships and roles, so a disagreement is understood in context rather than as one person's position." },
    { term: "Least-restrictive setting", definition: "The care arrangement that meets the assessed need while limiting the person's freedom as little as possible." },
    { term: "Dual relationship risk", definition: "The conflict that arises when a worker holds a second role with a client or family that could compromise judgement." },
  ],
  note: "Watch the capacity section with this cohort. Several students collapse capacity into diagnosis. The placement supervisor asked for the sibling conflict to stay unresolved in the brief.",
  ratings: [4, 5, 4, 3, 5],
  disputes: 0,
  edits: SOCIAL_WORK_EDITS,
};

async function clean() {
  // FK cascades from cases remove variants, responses, and events.
  await db.delete(cases).where(inArray(cases.id, CASE_IDS));
  console.log("removed seed rows");
}

async function seedCase(cfg: CaseCfg) {
  const data = read(cfg.sample);
  const phases = getDisciplinePack(cfg.discipline).defaultPhases;
  // The raw generation, kept separate so the generation_completed event records
  // what the model actually produced rather than what the instructor approved.
  const raw: SeedContent = data.output;
  const edited = applyInstructorEdits(raw, cfg.edits);
  const content = { schemaVersion: 1, ...normaliseSeedContent(edited), glossary: cfg.glossary };

  const createdAt = new Date(isoDaysAgo(6, 9));
  const approvedAt = new Date(isoDaysAgo(5, 9));
  const firstViewedAt = new Date(isoDaysAgo(4, 9));
  const openPhase = cfg.openAtLastPhase ? phases[phases.length - 1] : phases[1];

  await db.insert(cases).values({
    id: cfg.id,
    instructorId: ADMIN_ID,
    discipline: cfg.discipline,
    learningObjective: data.input.learningObjective,
    difficulty: data.input.difficulty,
    mustCoverConcepts: data.input.mustCoverConcepts,
    targetLearnerProfile: data.input.targetLearnerProfile,
    contentJson: content,
    phasesJson: phases,
    currentPhaseId: openPhase.id,
    status: "released",
    // Set explicitly rather than left to the column defaults, which would stamp
    // every seeded case as created now and so approved before it existed.
    createdAt,
    updatedAt: new Date(isoDaysAgo(3, 9)),
    authoringStartedAt: createdAt,
    authoringApprovedAt: approvedAt,
    authoringSecondsLogged: 9 * 60 + 40,
    regenerationCount: cfg.regenSections.length,
  });

  for (const t of cfg.teams) {
    // The committed variant is already derived from the instructor-edited
    // master, because scripts/generate-demo-variants.ts applies the same edit
    // list before personalising. Applying it again here would double the
    // paragraphs and sentences those edits add.
    const variantContent = { schemaVersion: 1, ...normaliseSeedContent(readVariant(t.contentFile)) };
    await db.insert(caseVariants).values({
      id: t.id,
      caseId: cfg.id,
      learnerProfileJson: {
        displayName: t.name,
        industry: t.industry,
        role: t.role,
        // The master case's, as the app records it: prior knowledge is set once
        // per case and is not collected per team.
        priorKnowledge: data.input.targetLearnerProfile.priorKnowledge,
        teamSize: t.size,
      },
      contentJson: variantContent,
      inviteToken: t.token,
      createdAt: new Date(isoDaysAgo(5, 10)),
      viewCount: t.views,
      firstViewedAt,
      lastViewedAt: new Date(now - 2 * 3600_000),
    });
  }

  // What the check read on the raw draft, before the instructor edits. The
  // finance and social-work drafts each missed concepts at this point, which is
  // why the edits below them exist.
  const rawCoverage = checkConceptCoverage(raw, data.input.mustCoverConcepts);
  const rawGrounding = groundingUtilisation(raw, data.provenance, data.input);

  // Authoring lifecycle events: generation, then the instructor edits, then
  // approval and release. Every timestamp is ordered, and nothing a student
  // does is stamped before the case was released.
  const events: { t: string; type: string; vid?: string; meta?: unknown }[] = [
    { t: isoDaysAgo(6, 9), type: "created" },
    { t: isoDaysAgo(6, 9), type: "generation_started" },
    {
      t: isoDaysAgo(6, 9),
      type: "generation_completed",
      meta: {
        retrieval: data.provenance,
        conceptsCovered: rawCoverage.covered,
        conceptsMissing: rawCoverage.missing,
        groundingUsed: rawGrounding.used,
        groundingCountable: rawGrounding.countable,
        groundingTotal: rawGrounding.total,
      },
    },
    ...cfg.regenSections.map((section) => ({ t: isoDaysAgo(6, 10), type: "section_regenerated", meta: { section } })),
    ...cfg.edits.map((e, i) => ({
      t: isoDaysAgo(6, 11 + Math.floor(i / 4)),
      type: "edit_saved",
      meta: {
        contentChanged: true,
        phasesChanged: false,
        specChanged: false,
        section: e.section,
        note: e.note,
      },
    })),
    { t: isoDaysAgo(5, 9), type: "approved", meta: { authoringSeconds: 580 } },
    { t: isoDaysAgo(5, 9), type: "released" },
    ...cfg.teams.map((t) => ({ t: isoDaysAgo(5, 10), type: "variant_spawned", vid: t.id })),
    { t: isoDaysAgo(3, 9), type: "phase_advanced", meta: { toPhaseId: openPhase.id } },
    { t: isoDaysAgo(4, 11), type: "instructor_note", meta: { note: cfg.note, author: "Co-instructor" } },
  ];

  // Student-reported quality signals, spread across the recent window.
  cfg.ratings.forEach((rating, i) => {
    const team = cfg.teams[i % cfg.teams.length];
    events.push({
      t: isoDaysAgo(Math.max(0, 4 - (i % 4)), 15 + (i % 5)),
      type: "quality_rated",
      vid: team.id,
      meta: { rating },
    });
  });
  for (let d = 0; d < cfg.disputes; d++) {
    events.push({
      t: isoDaysAgo(1, 16 + d),
      type: "feedback_disputed",
      vid: cfg.teams[0].id,
    });
  }

  // Student activity spread across the days after release, ramping toward
  // recent. The case was released 5 days ago, so views start on day 4: no team
  // link is recorded as opened before the instructor released it.
  for (const t of cfg.teams) {
    for (let v = 0; v < t.views; v++) {
      const day = Math.max(0, 4 - Math.floor((v * 5) / Math.max(1, t.views))); // 4..0
      events.push({
        t: isoDaysAgo(day, 9 + (v % 9)),
        type: "variant_viewed",
        vid: t.id,
        meta: { viewerHash: `${t.token}-s${(v % t.size) + 1}` },
      });
    }
    for (let r = 0; r < t.responses; r++) {
      const day = Math.max(0, 4 - r);
      const activity = r === 0 ? "clarifying_questions" : "notes";
      events.push({
        t: isoDaysAgo(day, 14 + (r % 6)),
        type: "response_saved",
        vid: t.id,
        meta: { phaseId: phases[Math.min(r, 1)].id, activityType: activity },
      });
    }
  }

  for (const e of events) {
    await db.insert(caseEvents).values({
      timestampIso: e.t,
      caseId: cfg.id,
      variantId: e.vid ?? null,
      eventType: e.type,
      metadata: (e.meta ?? null) as object | null,
    });
  }

  return { teams: cfg.teams.length, events: events.length };
}

async function seedStudentSubmissions(phasesFinance: ReturnType<typeof getDisciplinePack>["defaultPhases"]) {
  // Written submissions for the first finance team. The instructor view needs
  // them to show answers and the rubric-assessment action.
  //
  // The figures are Team Alpha's own, from demo/sample-variants/
  // finance-retail.json: a $1.50 dividend, 3% to 5% growth and an 8% to 10%
  // cost of equity. Keep them in step if that variant changes, otherwise the
  // seeded students are asking about a case they were never given.
  const lastPhaseId = phasesFinance[phasesFinance.length - 1].id;
  await db.insert(studentResponses).values([
    {
      variantId: "seed-f1",
      phaseId: phasesFinance[0].id,
      activityType: "clarifying_questions",
      contentJson: {
        items: [
          "The scenario says the DDM figure is entirely a terminal value. Should we take the 5% growth as the perpetual rate, or argue for something lower?",
          "Is the 10% end of the cost-of-equity range a CAPM estimate, and what beta does it assume?",
        ],
      },
    },
    {
      variantId: "seed-f1",
      phaseId: lastPhaseId,
      activityType: "answer_attempt",
      contentJson: {
        text: "Using the DDM with next year's dividend of about $1.58 (1.50 grown at 5%) and a 10% cost of equity, the single-stage Gordon model gives an intrinsic value near $31.50 per share (1.575 / (0.10 - 0.05)). Because the whole figure is a terminal value, it is very sensitive to the spread between cost of equity and growth: at 3% growth it falls to roughly $22.07 (1.545 / (0.10 - 0.03)), and at an 8% cost of equity with 5% growth it rises to about $52.50. We would flag that a 5% perpetual growth rate is aggressive for a regional bank and recommend a base case nearer 3%, making the recommendation conditional on the cost-of-equity estimate.",
      },
    },
  ]);
}

// A finance case that has not been approved, with a co-instructor note. Every
// other seeded case is released. The demo-video recorder duplicates this one
// and works on the copy, where regeneration and approval are still available.
async function seedDraftCase() {
  const data = read(FINANCE.sample);
  const phases = getDisciplinePack("finance").defaultPhases;
  // Left as the raw generation on purpose: this case sits before approval, so
  // it is the state the instructor edits are made from, and its must-cover
  // banner shows the miss that the released case no longer has.
  const content = { schemaVersion: 1, ...data.output, glossary: FINANCE.glossary };
  const grounding = groundingUtilisation(data.output, data.provenance, data.input);
  const createdAt = new Date(isoDaysAgo(0, 9));
  await db.insert(cases).values({
    id: DRAFT_CASE_ID,
    instructorId: ADMIN_ID,
    discipline: "finance",
    learningObjective: data.input.learningObjective,
    difficulty: data.input.difficulty,
    mustCoverConcepts: data.input.mustCoverConcepts,
    targetLearnerProfile: data.input.targetLearnerProfile,
    contentJson: content,
    phasesJson: phases,
    currentPhaseId: null,
    status: "editing",
    createdAt,
    updatedAt: createdAt,
    authoringStartedAt: createdAt,
    authoringSecondsLogged: null,
    regenerationCount: 1,
  });
  await db.insert(caseEvents).values([
    { timestampIso: isoDaysAgo(0, 9), caseId: DRAFT_CASE_ID, variantId: null, eventType: "created", metadata: null },
    { timestampIso: isoDaysAgo(0, 9), caseId: DRAFT_CASE_ID, variantId: null, eventType: "generation_completed", metadata: { retrieval: data.provenance, groundingUsed: grounding.used, groundingCountable: grounding.countable, groundingTotal: grounding.total } },
    {
      timestampIso: isoDaysAgo(0, 10),
      caseId: DRAFT_CASE_ID,
      variantId: null,
      eventType: "instructor_note",
      metadata: { note: "Draft for the section on bank valuation. Checking the figures before I approve and release.", author: "Co-instructor" },
    },
  ]);
}

// The pinned baselines
//
// The two baselines of each released seed case are committed under
// demo/sample-comparisons and loaded from there, so seeding writes the same
// cache every time and makes no model call. The readings in
// demo/comparison-readings.json are read off these texts, and a fresh sample
// changes them. --regenerate-comparisons generates new ones
// and rewrites the files, which is how they are replaced on purpose.

const COMPARISON_DIR = join(process.cwd(), "demo/sample-comparisons");

interface PinnedComparison {
  caseId: string;
  // The commit, the date and the model of the run that wrote this file.
  provenance: ReturnType<typeof resultProvenance>;
  source: string;
  modelId: string;
  // When the model produced these two baselines. Written into the cache, so the
  // date the contrastive view shows does not move with the seeding run.
  baselinesGeneratedAt: string;
  plainText: string;
  structuredJson: GenerationOutput;
  structuredProvenance: string[];
}

function comparisonFile(caseId: string): string {
  return join(COMPARISON_DIR, `${caseId}.json`);
}

function readPinnedComparison(caseId: string): PinnedComparison {
  return JSON.parse(readFileSync(comparisonFile(caseId), "utf8")) as PinnedComparison;
}

export function writePinnedComparison(
  pinned: Omit<PinnedComparison, "provenance" | "source">,
): void {
  mkdirSync(COMPARISON_DIR, { recursive: true });
  const file: PinnedComparison = {
    caseId: pinned.caseId,
    provenance: resultProvenance(pinned.modelId),
    source:
      "the two baselines of this seeded case: one plain prompt and one structured generation with retrieval off, both on the brief in demo/sample-inputs. Loaded by scripts/seed-demo.ts, which makes no model call for them.",
    modelId: pinned.modelId,
    baselinesGeneratedAt: pinned.baselinesGeneratedAt,
    plainText: pinned.plainText,
    structuredJson: pinned.structuredJson,
    structuredProvenance: pinned.structuredProvenance,
  };
  writeFileSync(comparisonFile(pinned.caseId), JSON.stringify(file, null, 2) + "\n");
}

// Write the committed baselines into the compare cache. No model calls.
async function seedPinnedComparisons(cfgs: CaseCfg[]) {
  let written = 0;
  for (const cfg of cfgs) {
    const pinned = readPinnedComparison(cfg.id);
    await db.insert(caseComparisons).values({
      caseId: cfg.id,
      plainText: pinned.plainText,
      structuredJson: pinned.structuredJson,
      structuredProvenance: pinned.structuredProvenance,
      modelId: pinned.modelId,
      generatedAt: new Date(pinned.baselinesGeneratedAt),
    });
    written++;
    console.log(
      `  comparison cached for ${cfg.id} from ${cfg.id}.json (${pinned.modelId}, generated ${pinned.baselinesGeneratedAt})`,
    );
  }
  return written;
}

// Generate the two baselines again, write them into the cache and rewrite the
// committed files. Two model calls per case.
async function regenerateComparisons(cfgs: CaseCfg[]) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log(
      "no OPENAI_API_KEY: cannot regenerate the baselines; the compare cache is left empty",
    );
    return 0;
  }
  let written = 0;
  for (const cfg of cfgs) {
    const data = read(cfg.sample);
    const input: CaseInput = {
      discipline: cfg.discipline,
      learningObjective: data.input.learningObjective,
      difficulty: data.input.difficulty,
      mustCoverConcepts: data.input.mustCoverConcepts,
      targetLearnerProfile: data.input.targetLearnerProfile,
    };
    try {
      // The structured baseline occasionally fails schema validation, so it
      // gets one retry, as generation does in the app.
      const [plain, structured] = await Promise.all([
        generatePlainCase(input),
        generateStructuredNoRetrieval(input).catch(() => generateStructuredNoRetrieval(input)),
      ]);
      const generatedAt = new Date();
      await db.insert(caseComparisons).values({
        caseId: cfg.id,
        plainText: plain.text,
        structuredJson: structured.output,
        structuredProvenance: structured.provenance,
        modelId: plain.modelId,
        generatedAt,
      });
      writePinnedComparison({
        caseId: cfg.id,
        modelId: plain.modelId,
        baselinesGeneratedAt: generatedAt.toISOString(),
        plainText: plain.text,
        structuredJson: structured.output,
        structuredProvenance: structured.provenance,
      });
      written++;
      console.log(`  comparison regenerated for ${cfg.id} (${plain.modelId}), file rewritten`);
    } catch (err) {
      console.log(
        `  comparison skipped for ${cfg.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return written;
}

async function seed() {
  await clean();
  await db
    .insert(users)
    .values({ id: ADMIN_ID, email: "admin", role: "instructor" })
    .onConflictDoNothing({ target: users.id });

  let teams = 0;
  let events = 0;
  for (const cfg of [FINANCE, MARKETING, SOCIAL_WORK]) {
    const r = await seedCase(cfg);
    teams += r.teams;
    events += r.events;
  }
  await seedStudentSubmissions(getDisciplinePack("finance").defaultPhases);
  await seedDraftCase();
  const comparisons = !withComparisons
    ? 0
    : regenerating
      ? await regenerateComparisons([FINANCE, MARKETING, SOCIAL_WORK])
      : await seedPinnedComparisons([FINANCE, MARKETING, SOCIAL_WORK]);
  console.log(
    `seeded ${CASE_IDS.length} cases (incl. 1 draft), ${teams} teams, ${events} events, ${comparisons} cached comparisons`,
  );
}

const withComparisons = !process.argv.includes("--no-comparisons");
const regenerating = process.argv.includes("--regenerate-comparisons");
const cleaning = process.argv.includes("--clean");
const mode = cleaning ? clean : seed;

// Seeding rewrites whatever database POSTGRES_URL points at, and environment
// variables pulled from Vercel point at the database of the live demo. A host
// that is not local has to be confirmed on the command line.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const SHARED_DB_FLAG = "--yes-shared-database";

function databaseHost(): string | null {
  const url = process.env.POSTGRES_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function describePlan(): void {
  console.log(
    cleaning
      ? "seed-demo --clean would delete, on this database:"
      : "seed-demo would delete, then insert, on this database:",
  );
  console.log(
    `  delete: every row whose case id is one of ${CASE_IDS.join(", ")}, ` +
      "together with the team variants, events, student responses and cached " +
      "comparisons that hang off them. Rows created through the interface are " +
      "left alone.",
  );
  if (cleaning) return;
  console.log(
    "  insert: 3 released cases (finance, marketing, social work) and 1 draft, " +
      "their team variants, the authoring events and student responses behind the " +
      "analytics page, and" +
      (!withComparisons
        ? " no cached comparisons, since --no-comparisons was passed."
        : regenerating
          ? " a cached contrastive comparison for each released case, generated afresh" +
            " (2 model calls per case) and written back over demo/sample-comparisons."
          : " a cached contrastive comparison for each released case, read from" +
            " demo/sample-comparisons. No model calls."),
  );
}

function guardDatabase(): void {
  const host = databaseHost();
  console.log(`database host: ${host ?? "not set (POSTGRES_URL is missing)"}`);
  describePlan();
  if (host && LOCAL_HOSTS.has(host)) return;
  if (process.argv.includes(SHARED_DB_FLAG)) {
    console.log(`proceeding on a non-local database because ${SHARED_DB_FLAG} was passed`);
    return;
  }
  console.error(
    `\nRefusing to run: ${host ?? "no host"} is not a local database, and the ` +
      "rows above would be deleted there. This is what the live demo runs on when " +
      "the environment came from `vercel env pull`.\n" +
      `Point POSTGRES_URL at a local database, or pass ${SHARED_DB_FLAG} if you ` +
      "mean to rewrite the shared one.",
  );
  process.exit(1);
}

// Only seed when this file is run as a script. The instructor-edit lists above
// are exported so they can be read and checked without a database connection
// and without writing anything.
// The three case configurations are exported too, so that
// scripts/generate-demo-variants.ts writes a file for every team this script
// loads, with the team's own practice context, and the two cannot drift apart.
export { FINANCE_EDITS, MARKETING_EDITS, SOCIAL_WORK_EDITS, applyInstructorEdits };
export { normaliseSeedScenario };
export { FINANCE, MARKETING, SOCIAL_WORK };
export type { CaseCfg, InstructorEdit, SeedContent, Team };

if (process.argv[1]?.replace(/\\/g, "/").endsWith("seed-demo.ts")) {
  guardDatabase();
  mode()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
