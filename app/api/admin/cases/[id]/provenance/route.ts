import { NextResponse } from "next/server";
import { eq, and, asc } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases, caseVariants, caseEvents } from "@/lib/db/schema";
import {
  describeGenerationModel,
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSIONS,
} from "@/lib/llm/client";
import type { PhaseDefinition } from "@/lib/disciplines/types";

// Per-case provenance record: the brief the case was generated from, the
// approval that came before any student saw it, the authoring time, and the
// generations, edits and releases in order. It is one Markdown file built from
// the case row and its append-only event log.

const EVENT_LABELS: Record<string, string> = {
  created: "Case created",
  generation_started: "Generation started",
  generation_completed: "Draft generated",
  generation_failed: "Generation failed",
  section_regenerated: "Section regenerated",
  section_restored: "Previous text of a section restored",
  comparison_run: "Contrastive baselines run",
  edit_saved: "Edit saved by instructor",
  approved: "Approved by instructor",
  released: "Released to cohort",
  phase_advanced: "Phase advanced",
  variant_spawned: "Team variant created",
  variant_viewed: "Variant opened by a team",
  variant_opened_before_release: "Link opened before release, content withheld",
  response_saved: "Student response saved",
  attempt_assessed: "Answer assessed (formative)",
  feedback_requested: "Formative feedback requested",
  feedback_disputed: "Student flagged the feedback as off",
  hint_requested: "Hint requested",
  instructor_note: "Note added by an instructor",
  quality_rated: "Case rated by a student",
};

// Field names as a reader outside the project would say them, so the timeline
// does not read as raw JSON.
const META_LABELS: Record<string, string> = {
  afterPhaseClosed: "saved just after the phase closed",
  activityType: "activity",
  authoringSeconds: "authoring time in seconds",
  band: "band",
  capped: "authoring time cut off at the two-hour limit",
  contentChanged: "case text changed",
  duplicatedFrom: "duplicated from case",
  phasesChanged: "phase plan changed",
  specChanged: "brief changed",
  firstPhaseId: "first phase",
  team: "team",
  comment: "comment",
  conceptsCovered: "concepts found",
  conceptsMissing: "concepts not found",
  fromPhaseId: "from phase",
  groundingTotal: "retrieved notes",
  groundingUsed: "retrieved notes reflected",
  issues: "problems",
  newIndex: "phase number",
  notRated: "not rated",
  phaseId: "phase",
  questionCount: "discussion questions",
  rating: "rating out of 5",
  reason: "reason",
  scenarioLen: "scenario length in characters",
  section: "section",
  step: "hint number",
  toPhaseId: "to phase",
  total: "phases in total",
  viewerHash: "hashed viewer",
  words: "words",
};

function fmtValue(value: unknown): string {
  if (Array.isArray(value)) return value.join("; ");
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === null) return "none";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

function fmtMeta(meta: unknown): string {
  if (meta === null || meta === undefined) return "";
  if (typeof meta !== "object") return ` (${fmtValue(meta)})`;
  const entries = Object.entries(meta as Record<string, unknown>).filter(
    ([k, v]) =>
      // The retrieved notes are set out in full under Models and retrieval, so
      // the timeline repeats neither the display strings nor the numbers logged
      // beside them.
      k !== "retrieval" &&
      k !== "retrievalScores" &&
      v !== undefined &&
      v !== null &&
      v !== "" &&
      !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return "";
  return ` (${entries
    .map(([k, v]) => `${META_LABELS[k] ?? k}: ${fmtValue(v)}`)
    .join(", ")})`;
}

// The retrieval provenance recorded at generation is a flat list of strings of
// the form "embedding:<model>" and "corpus:<note id> (<score>)". Split it back
// out so the record names the embedding model and each corpus note separately.
function splitProvenance(entries: string[]): {
  embeddingModel: string | null;
  notes: { id: string; score: string | null }[];
  other: string[];
} {
  let embeddingModel: string | null = null;
  const notes: { id: string; score: string | null }[] = [];
  const other: string[] = [];
  for (const raw of entries) {
    if (raw.startsWith("embedding:")) {
      embeddingModel = raw.slice("embedding:".length);
      continue;
    }
    const note = raw.match(/^corpus:(\S+)(?:\s+\(([\d.]+)\))?$/);
    if (note) {
      notes.push({ id: note[1], score: note[2] ?? null });
      continue;
    }
    other.push(raw);
  }
  return { embeddingModel, notes, other };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;

  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const events = await db
    .select()
    .from(caseEvents)
    .where(eq(caseEvents.caseId, id))
    .orderBy(asc(caseEvents.timestampIso));

  const variants = await db
    .select({ id: caseVariants.id })
    .from(caseVariants)
    .where(eq(caseVariants.caseId, id));

  const profile = c.targetLearnerProfile as {
    industry?: string;
    role?: string;
    priorKnowledge?: string;
  };
  const concepts = Array.isArray(c.mustCoverConcepts)
    ? (c.mustCoverConcepts as string[])
    : [];
  const phases = (c.phasesJson as PhaseDefinition[]) ?? [];
  // Whole minutes, the same rounding as the editor shows.
  const authoringMinutes =
    c.authoringSecondsLogged != null ? Math.round(c.authoringSecondsLogged / 60) : null;

  // The model that produced the draft, and the retrieval that grounded it. The
  // retrieval list was recorded with the generation_completed event; the model
  // is the one this instance is configured with.
  const generationProvider = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
  let generationModel = "(not recorded)";
  try {
    generationModel = describeGenerationModel();
  } catch {
    // provider misconfigured: the record does not name the model
  }
  const lastGeneration = [...events]
    .reverse()
    .find((e) => e.eventType === "generation_completed");
  const retrievalEntries =
    ((lastGeneration?.metadata as { retrieval?: unknown } | null)?.retrieval as
      | string[]
      | undefined) ?? [];
  const retrieval = splitProvenance(retrievalEntries);

  const L: string[] = [];
  L.push(`# PersCase provenance record`);
  L.push("");
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push("");
  L.push(`Record of how one case was authored: brief, models, retrieved notes, approval`);
  L.push(`and event log. The case was drafted by a large language model from the brief`);
  L.push(`below and the retrieved notes listed under Models and retrieval.`);
  L.push(
    c.authoringApprovedAt
      ? `The instructor approved it before any student could open it.`
      : `It has not been approved, and no student can open it until it is.`,
  );
  L.push("");
  L.push(`## Case`);
  L.push(`- ID: ${c.id}`);
  L.push(`- Discipline: ${c.discipline}`);
  L.push(`- Difficulty: ${c.difficulty}`);
  L.push(`- Status: ${c.status}`);
  L.push(`- Learning objective: ${c.learningObjective}`);
  L.push(`- Must-cover concepts: ${concepts.length ? concepts.join("; ") : "(none)"}`);
  L.push(
    `- Target learner: ${[profile.role, profile.industry, profile.priorKnowledge]
      .filter(Boolean)
      .join(", ") || "(unspecified)"}`,
  );
  L.push(`- Team variants generated: ${variants.length}`);
  L.push("");
  L.push(`## Authoring effort`);
  L.push(`- Created: ${c.createdAt.toISOString()}`);
  L.push(
    `- Approved: ${c.authoringApprovedAt ? c.authoringApprovedAt.toISOString() : "(not yet approved)"}`,
  );
  L.push(`- Logged authoring time: ${authoringMinutes != null ? `${authoringMinutes} min` : "(not recorded)"}`);
  L.push(`- Section regenerations: ${c.regenerationCount}`);
  L.push("");
  L.push(`## Models and retrieval`);
  L.push(`- Generation model: ${generationModel}`);
  L.push(`- Model provider: ${generationProvider}`);
  L.push(
    `- Embedding model: ${retrieval.embeddingModel ?? EMBEDDING_MODEL_ID} (${EMBEDDING_DIMENSIONS} dimensions)`,
  );
  if (retrieval.notes.length > 0) {
    L.push(`- Corpus notes retrieved for the draft, with similarity scores:`);
    for (const n of retrieval.notes) {
      L.push(`  - ${n.id}${n.score ? ` (${n.score})` : ""}`);
    }
  } else {
    L.push(`- Corpus notes retrieved for the draft: (none recorded)`);
  }
  for (const note of retrieval.other) {
    L.push(`- Retrieval note: ${note}`);
  }
  L.push(
    `The corpus notes are written by the authors of PersCase, not by a teaching department.`,
  );
  L.push("");
  L.push(`## Phase plan`);
  for (const p of [...phases].sort((a, b) => a.order - b.order)) {
    L.push(`${p.order + 1}. ${p.label}`);
  }
  L.push("");
  L.push(`## Audit timeline`);
  if (events.length === 0) {
    L.push("(no events recorded)");
  } else {
    for (const e of events) {
      const label = EVENT_LABELS[e.eventType] ?? e.eventType;
      L.push(`- ${e.timestampIso} · ${label}${fmtMeta(e.metadata)}`);
    }
  }
  L.push("");

  const md = L.join("\n");
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="perscase-provenance-${id}.md"`,
    },
  });
}
