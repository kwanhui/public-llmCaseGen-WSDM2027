"use client";

import Link from "next/link";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { CONCEPT_MARK, ConceptIndex, NOTE_MARK, highlightSpecs } from "@/components/compare/marks";
import type { ArmSignals } from "@/lib/generation/compare";
import type { CaseContent, CaseSection, GenerationOutput } from "@/lib/generation/schema";
import type { CaseInput, Difficulty } from "@/lib/disciplines/types";
import {
  DEMO_COST,
  DEMO_MAX_HINTS,
  type DemoBudgetResponse,
  type DemoGenerateResponse,
  type DemoRegenerateResponse,
  type DemoStudentCaseResponse,
} from "@/lib/demo/contracts";
import { computeDifferences, draftTextOf, listInWords } from "@/lib/demo/differences";
import { SECTION_NAMES, sectionToRegenerate } from "@/lib/demo/regenerate";
import { cn } from "@/lib/utils";
import {
  Column,
  DraftView,
  ErrorLine,
  draftBase,
  PersCaseStudentView,
  PlainStudentView,
  VariantView,
  type BaselineArm,
  type DraftData,
  type GenerateResult,
  type PersonaliseResult,
  type RetrievalTrace,
  type Step,
  type StudentData,
  type StudentResult,
  type VariantData,
} from "./column";
import { DifferencesPanel } from "./differences";
import { GuardedButton } from "./guarded-button";
import {
  SPOTLIGHT_MS,
  createGuidedRun,
  type GuidedBanner,
  type GuidedPace,
  type GuidedStep,
} from "./guided-run";
import { Progress } from "./progress";
import { ReadingsStrip } from "./readings";
import { RetrievalStep, STAGE_MS } from "./retrieval-step";
import { StepBanner } from "./step-banner";
import {
  CONCEPT_MAX,
  DISCIPLINE_LABELS,
  FINANCE_LAST_PHASE,
  defaultTeamIndex,
  MAX_CONCEPTS,
  MESSAGE_MAX,
  namedQuestionNumber,
  OBJECTIVE_MAX,
  PRESETS,
  PROFILE_FIELD_MAX,
  SCRIPT_DEFAULT_PRESET_ID,
  SEEDED_FINANCE_CASE_ID,
  STUDENT_ASK_FOR_ANSWER,
  STUDENT_DRAFT_ANSWER,
  studentMode,
  wordCount,
  type DemoPreset,
} from "./presets";

// Copy

const BASELINE_LABELS: Record<BaselineArm, string> = {
  plain: "Plain prompt",
  // The compare page's name for this baseline.
  structured: "Structured, no retrieval",
};

const BASELINE_BLURBS: Record<BaselineArm, string> = {
  plain: "One prompt with the brief, no retrieval, no output schema, no discipline prompt.",
  structured:
    "The same discipline prompt and output schema as the PersCase column, with retrieval switched off.",
};

const PERSCASE_BLURB = "Retrieved notes, output schema, must-cover check.";

const STUDENT_LEFT_BLURB =
  "One plain prompt with the case scenario, its discussion questions and the student's message.";
const STUDENT_RIGHT_BLURB =
  "Graduated hints, three at most, and feedback against the case's rubric.";

const LEFT_DRAFT_STAGES = ["generating"];
// Retrieval has its own readout above the draft (RETRIEVAL_STAGES), and is
// skipped when the notes for this brief are already on the page.
const RETRIEVAL_STAGES = ["embedding the brief", "ranking the notes by similarity"];
const RIGHT_DRAFT_STAGES = [
  "generating the structured draft from the retrieved notes",
  "checking must-cover concepts",
  "reading the retrieved notes",
];
const LEFT_VARIANT_STAGES = ["rewriting the draft for the team"];
const RIGHT_VARIANT_STAGES = [
  "rewriting the draft for the team",
  "checking must-cover concepts",
  "comparing sentences with the draft",
];
const RIGHT_HINT_STAGES = ["reading the case and the task", "writing the next hint"];
const RIGHT_FEEDBACK_STAGES = ["reading the case and the rubric", "assessing the answer against the rubric"];

const STEPS = [
  "Retrieve the notes",
  "Compare the drafts",
  "Fix a missed concept",
  "Personalise for a team",
  "As a student, ask for the answer",
  "As a student, send an answer for feedback",
];

type Scene = "instructor" | "student";
const SCENES: { id: Scene; label: string }[] = [
  { id: "instructor", label: "Instructor: create a personalised case" },
  { id: "student", label: "Student: answer the case" },
];

type SourceKind = "seed" | "generated";

// How the student scene's card and its Case select name the case the student
// answers. The seeded case is the same example case that the admin screens
// show, and the student page calls it "Example case".
const CASE_TITLES: Record<SourceKind, string> = {
  seed: "Example bank case",
  generated: "The case generated above",
};

// The strip's and the banner's text for step 3 when the check flagged nothing.
// The trigger is the PersCase check alone: the standard column has no check,
// so a concept missing from its text does not call for the step.
function fixNotNeeded(conceptCount: number): string {
  if (conceptCount === 0) return "Fix a missed concept: not needed, the brief lists no concepts";
  const n = NUMBER_WORDS[conceptCount] ?? String(conceptCount);
  return `Fix a missed concept: not needed, the PersCase check shows all ${n} present`;
}
const NUMBER_WORDS = ["zero", "one", "two", "three", "four"];
// How long the banner shows that text before the run moves on.
const SKIP_NOTICE_MS = 2000;

// Shown in the banner's place for DONE_NOTICE_MS once a run has finished, and
// under the step strip until the next run starts.
const DEMO_COMPLETE =
  "Demo complete. Scroll up to compare the columns, or run it again with another brief.";
const DONE_NOTICE_MS = 6000;

// A phase title as the student page shows it: without its number, which the
// page states separately, and with "&" written out as "and".
function phaseTitleText(title: string): string {
  return title.replace(/^\s*\d+[.)]\s+/, "").replace(/\s*&\s*/g, " and ");
}

// A route's error message as the rest of the sentence "Step n stopped: ...":
// the first letter lower-cased (unless the first word is a name such as
// PersCase), and "Try again." dropped, since the banner offers the retry.
function asClause(message: string): string {
  let m = message.replace(/\s*Try again\.?\s*$/, "").trim();
  if (!/[.!?]$/.test(m)) m += ".";
  return /^[A-Z][a-z]*\b/.test(m) && !/^[A-Z][a-z]*[A-Z]/.test(m) ? m.charAt(0).toLowerCase() + m.slice(1) : m;
}

// Why a step with two columns did not complete, from the columns' messages.
// The PersCase column's failure is named first; a PersCase message is given
// on its own, as the run is about that column.
function twoColumnFailure(
  what: string,
  left: string | null,
  right: string | null,
): string {
  if (right && left) return `${asClause(right)} The standard LLM ${what} failed as well.`;
  if (right) return asClause(right);
  if (left) return `the standard LLM ${what} failed: ${asClause(left)}`;
  return "this step did not complete.";
}

// Announced through the page's status region when both columns have a result.
const READY_MESSAGES = {
  draft: "Both drafts are ready",
  regenerate: "The regenerated PersCase draft is ready",
  variant: "Both variants are ready",
  student: "Both replies are ready",
} as const;
type ResultStep = keyof typeof READY_MESSAGES;

// The seeded case's questions and task, read once (no model call) when the
// student scene is first opened.
type SeedCase =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; data: DemoStudentCaseResponse };

const PACES: { id: GuidedPace; label: string }[] = [
  { id: "play", label: "Play" },
  { id: "step", label: "Step by step" },
];

// Added to a control while the guided run points at it.
const SPOTLIGHT_CLASSES = ["ring-2", "ring-primary", "ring-offset-2", "animate-pulse"];

// Where the guided run scrolls when a step's own target is not on the page,
// for example a differences panel with no cards.
const SCROLL_FALLBACKS: Record<string, string> = {
  "differences-retrieval": "right-trace",
  "differences-draft": "demo-columns-instructor",
  "differences-regenerate": "demo-columns-instructor",
  "differences-variant": "demo-columns-instructor",
  "differences-student": "demo-columns-student",
};

// The preset the page opens with and the guided run uses.
const DEFAULT_PRESET = PRESETS.find((p) => p.id === SCRIPT_DEFAULT_PRESET_ID) ?? PRESETS[0];

const DIFFICULTIES: Difficulty[] = ["novice", "intermediate", "advanced"];

// What each action costs in the routes' units (DEMO_COST), so that the page
// can refuse one that the visitor's remaining allowance would not cover
// before any part of it is sent.
const ACTION_COST = {
  retrieve: DEMO_COST.retrieve,
  generateBoth: DEMO_COST.retrieve + 2 * DEMO_COST.generate,
  // Both drafts from notes already retrieved for the same brief.
  generateFromNotes: 2 * DEMO_COST.generate,
  generateLeft: DEMO_COST.generate,
  // One section of the PersCase draft; the standard column has nothing to
  // regenerate.
  regenerate: DEMO_COST.regenerate,
  personalise: 2 * DEMO_COST.personalise,
  send: 2 * DEMO_COST.student,
  hint: DEMO_COST.student,
} as const;

// One guided run: the retrieval, both drafts from those notes, both variants
// and the two student messages (13 units; step 3, when it runs, adds 2). The
// page speaks of the allowance only when less than this is left.
const RUN_COST =
  ACTION_COST.retrieve + ACTION_COST.generateFromNotes + ACTION_COST.personalise + 2 * ACTION_COST.send;

// Said only when the allowance will not cover a whole run. A count of runs
// left is not shown: the allowance is kept per server instance, so a count
// read from one instance can be wrong for the next request.
function shortAllowanceText(a: DemoBudgetResponse): string | null {
  if (a.remaining === null || a.remaining >= RUN_COST) return null;
  const m = Math.max(1, Math.ceil((a.retryAfterSec ?? 60) / 60));
  return `Not enough for a full run; the next one in about ${m} minute${m === 1 ? "" : "s"}`;
}

// Where a refusal for lack of allowance is shown: beside the run button, the
// brief's buttons, or Send.
type RefusalPlace = "run" | "instructor" | "student";

function refusalMessage(retryAfterSec: number | null): string {
  const m = Math.max(1, Math.ceil((retryAfterSec ?? 60) / 60));
  return `Not enough allowance for this step; try again in ${m} minute${m === 1 ? "" : "s"}`;
}

// A request refused by the rate limiter (or the daily limit) before any model
// call: the step it belonged to is undone rather than shown half-done.
function refusedForAllowance(o: { ok: boolean; status?: number }): boolean {
  return !o.ok && o.status === 429;
}

const ALLOWANCE_NOTICE =
  "The allowance ran out during this step, so this column's request was refused. Both columns keep their results from before the step.";

// The height of the shared site header, which stays at the top of the
// viewport; the step banner sticks just under it.
function siteHeaderHeight(): number {
  const h = document.querySelector<HTMLElement>("header");
  return h && getComputedStyle(h).position === "sticky" ? h.offsetHeight : 0;
}

// How far below the top of the viewport a scrolled-to element is placed: under
// the site header and the step banner, with a margin.
function stickyOffset(): number {
  return (
    siteHeaderHeight() +
    (document.querySelector<HTMLElement>("[data-step-banner]")?.offsetHeight ?? 0) +
    12
  );
}

// Keys that scroll the page, which end the guided run's hold on the trace.
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "]);

// Holds an element under the sticky step banner while the page around it
// changes (the progress readouts grow, the other column's draft arrives):
// the first scroll is smooth, and every 250 ms after it the page is put back
// if the element has moved. Ends when the returned function is called, or
// when the reader scrolls the page. Returns the function that ends it.
function holdInView(id: string): () => void {
  let stopped = false;
  const offset = stickyOffset;
  const place = (behavior: ScrollBehavior) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (Math.abs(top - offset()) > 8) {
      window.scrollTo({ top: top + window.scrollY - offset(), behavior });
    }
  };
  place("smooth");
  const smoothUntil = Date.now() + 800;
  const timer = setInterval(() => {
    if (Date.now() >= smoothUntil) place("auto");
  }, 250);
  const onKey = (e: globalThis.KeyboardEvent) => {
    if (SCROLL_KEYS.has(e.key)) stop();
  };
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchmove", stop);
    window.removeEventListener("keydown", onKey);
  }
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchmove", stop, { passive: true });
  window.addEventListener("keydown", onKey);
  return stop;
}

// State

// The retrieval step's result: the notes retrieved for one brief, which the
// PersCase draft of that brief is generated from. `staged` reveals the notes
// one at a time (a guided run); `runId` gives each retrieval its own reveal.
interface RetrievalData {
  brief: CaseInput;
  trace: RetrievalTrace;
  provenance: string[];
  runId: number;
  staged: boolean;
}

function sameBrief(a: CaseInput, b: CaseInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Two frames: long enough for React to have rendered what was just set.
function afterRender(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

interface ColumnState {
  draft: Step<DraftData>;
  variant: Step<VariantData>;
  student: Step<StudentData>;
}

const IDLE = { status: "idle" } as const;
const LOADING = { status: "loading" } as const;
const EMPTY_COLUMN: ColumnState = { draft: IDLE, variant: IDLE, student: IDLE };

interface HintItem {
  hint: string;
  levelName: string;
  index: number;
  total: number;
}

interface FormState {
  presetId: string;
  brief: CaseInput;
  teamIndex: number;
}

function fromPreset(p: DemoPreset): FormState {
  const concepts = [...p.brief.mustCoverConcepts];
  while (concepts.length < MAX_CONCEPTS) concepts.push("");
  return {
    presetId: p.id,
    brief: {
      ...p.brief,
      mustCoverConcepts: concepts.slice(0, MAX_CONCEPTS),
      targetLearnerProfile: { ...p.brief.targetLearnerProfile },
    },
    teamIndex: defaultTeamIndex(p),
  };
}

// The runIds of the results a column holds. It changes when a new result
// arrives, and not when the baseline's readings are replaced in place.
function resultKey(...steps: Step<{ runId: number }>[]): string {
  return steps.map((s) => (s.status === "done" ? s.data.runId : "-")).join(" ");
}

// The element a control id or an element id names.
function findTarget(id: string): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`[data-control="${id}"]`) ??
    document.getElementById(id) ??
    (SCROLL_FALLBACKS[id] ? document.getElementById(SCROLL_FALLBACKS[id]) : null)
  );
}

// Scrolls the window to an element. A "start" target is placed under the
// sticky step banner rather than behind it.
function scrollToTarget(id: string, block: ScrollLogicalPosition) {
  const el = findTarget(id);
  if (!el) return;
  if (block !== "start") {
    el.scrollIntoView({ behavior: "smooth", block });
    return;
  }
  const offset = stickyOffset();
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: "smooth" });
}

// The nearest ancestor that scrolls its own content. It is found by its
// overflow style alone: when a result has just arrived the typewriter has not
// yet grown the content, so the box may not overflow at that moment.
function scrollParent(el: HTMLElement): HTMLElement | null {
  let box = el.parentElement;
  while (box && box !== document.body) {
    const overflow = getComputedStyle(box).overflowY;
    if (overflow === "auto" || overflow === "scroll") return box;
    box = box.parentElement;
  }
  return null;
}

// How long a box keeps following its anchor while the typewriter grows the
// content under it.
const BOX_FOLLOW_MS = 4000;

// Scrolls a column's box, and not the window, to the anchor with this id. A
// missing anchor scrolls the box that holds the marker to its end. While the
// box cannot yet reach the anchor (the text under it is still being revealed),
// the scroll is repeated as the content grows, until the anchor is reached,
// the reader scrolls the box, or BOX_FOLLOW_MS passes. Returns a cleanup.
function scrollBoxTo(anchorId: string, markerId: string): () => void {
  const anchor = document.getElementById(anchorId);
  if (!anchor) {
    const marker = document.querySelector<HTMLElement>(`[data-box-marker="${markerId}"]`);
    const box = marker ? scrollParent(marker) : null;
    box?.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    return () => {};
  }
  const box = scrollParent(anchor);
  if (!box) return () => {};
  const targetTop = () =>
    Math.max(0, anchor.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8);
  const reachable = () => box.scrollHeight - box.clientHeight >= targetTop() - 1;
  box.scrollTo({ top: targetTop(), behavior: "smooth" });
  if (reachable()) return () => {};

  const content = box.firstElementChild;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timer);
    box.removeEventListener("wheel", stop);
    box.removeEventListener("touchstart", stop);
  };
  const observer = new ResizeObserver(() => {
    box.scrollTo({ top: targetTop(), behavior: "smooth" });
    if (reachable()) stop();
  });
  if (content) observer.observe(content);
  const timer = setTimeout(stop, BOX_FOLLOW_MS);
  box.addEventListener("wheel", stop, { passive: true });
  box.addEventListener("touchstart", stop, { passive: true });
  return stop;
}

function runIdOf(step: Step<{ runId: number }>): number | null {
  return step.status === "done" ? step.data.runId : null;
}

function cleanBrief(b: CaseInput): CaseInput {
  return {
    discipline: b.discipline,
    learningObjective: b.learningObjective.trim(),
    difficulty: b.difficulty,
    mustCoverConcepts: b.mustCoverConcepts.map((c) => c.trim()).filter(Boolean),
    targetLearnerProfile: {
      industry: b.targetLearnerProfile.industry.trim(),
      role: b.targetLearnerProfile.role.trim(),
      priorKnowledge: b.targetLearnerProfile.priorKnowledge.trim(),
    },
  };
}

function toCaseContent(c: GenerationOutput): CaseContent {
  return {
    schemaVersion: 1,
    scenario: c.scenario,
    discussionQuestions: c.discussionQuestions,
    modelAnswers: c.modelAnswers,
    rubric: c.rubric,
    glossary: c.glossary,
  };
}

// Requests

type ApiOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; retryAfterSec?: number; paused?: boolean };

async function postJson<T>(url: string, body: unknown): Promise<ApiOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: "The request did not complete. Check the connection and try again." };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok && json) return { ok: true, data: json as T };
  const code = typeof json?.error === "string" ? json.error : undefined;
  const serverMessage = typeof json?.message === "string" ? json.message : undefined;
  const retryAfterSec = typeof json?.retryAfterSec === "number" ? json.retryAfterSec : undefined;
  const status = res.status;
  if (status === 503 && code === "demo_paused") {
    return { ok: false, status, paused: true, message: "The public demo is paused." };
  }
  if (status === 429) {
    return {
      ok: false,
      status,
      retryAfterSec,
      message: serverMessage ?? "Too many requests from this address. Try again shortly.",
    };
  }
  if (status === 413) {
    return { ok: false, status, message: serverMessage ?? "The input is too long for the public demo." };
  }
  if (status === 400) {
    return {
      ok: false,
      status,
      message: serverMessage
        ? `The input was not accepted: ${serverMessage}`
        : "The input was not accepted. Check the fields and try again.",
    };
  }
  if (status === 409 && code === "hint_limit") {
    return {
      ok: false,
      status,
      message: serverMessage ?? "All three hints have been used. Send a longer answer to get feedback.",
    };
  }
  if (status === 503) {
    return { ok: false, status, message: serverMessage ?? "The service is not available right now. Try again later." };
  }
  return {
    ok: false,
    status,
    message: serverMessage ?? (res.ok ? "The response could not be read." : `The request failed (HTTP ${status}).`),
  };
}

export function DemoClient({
  initiallyPaused = false,
  autorun = null,
  signedIn = false,
}: {
  initiallyPaused?: boolean;
  // Set by ?run=1 (play) or ?run=step: start the guided run after mount.
  autorun?: GuidedPace | null;
  // An instructor session: the contrastive-view link skips the sign-in page.
  signedIn?: boolean;
}) {
  const [scene, setScene] = useState<Scene>("instructor");
  const [form, setForm] = useState<FormState>(() => fromPreset(DEFAULT_PRESET));
  const [baseline, setBaseline] = useState<BaselineArm>("plain");
  const [left, setLeft] = useState<ColumnState>(EMPTY_COLUMN);
  const [right, setRight] = useState<ColumnState>(EMPTY_COLUMN);
  const [hints, setHints] = useState<HintItem[]>([]);
  const [studentModeSent, setStudentModeSent] = useState<"hint" | "feedback">("hint");
  // The mode of the student request in flight, for the progress stages.
  const [studentModePending, setStudentModePending] = useState<"hint" | "feedback" | null>(null);
  const [source, setSource] = useState<SourceKind>("seed");
  // The case the shown replies were for, and the seeded case's scenario as
  // the student route returns it (the page holds no text for that case).
  const [studentSourceSent, setStudentSourceSent] = useState<SourceKind>("seed");
  const [seedCaseText, setSeedCaseText] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [paused, setPaused] = useState(initiallyPaused);
  // Set by a 429: how long the buttons stay off. A new object restarts the wait.
  const [block, setBlock] = useState<{ ms: number } | null>(null);
  const [highlight, setHighlight] = useState(true);
  const [scriptRunning, setScriptRunning] = useState(false);
  const [pace, setPace] = useState<GuidedPace>(autorun ?? "play");
  const [banner, setBanner] = useState<GuidedBanner | null>(null);
  // Set when a guided run has finished: the "Demo complete" line shows in the
  // banner's place for DONE_NOTICE_MS (`doneNotice`) and under the step strip
  // until the next run starts (`runComplete`).
  const [runComplete, setRunComplete] = useState(false);
  const [doneNotice, setDoneNotice] = useState(false);
  // Set when a guided run ended with Stop after a failed step: the line under
  // the step strip says where it stopped, until the next run starts.
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  // The retrieval step: its result, whether it is running, and its error.
  const [retrieval, setRetrieval] = useState<RetrievalData | null>(null);
  const [retrieving, setRetrieving] = useState(false);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);
  // The section being regenerated, while the request runs.
  const [regenerating, setRegenerating] = useState<CaseSection | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  // The student replies that have come back, by mode, for the step strip.
  const [studentReached, setStudentReached] = useState({ hint: false, feedback: false });
  const [seedCase, setSeedCase] = useState<SeedCase>({ status: "loading" });
  // The student message the shown replies answer, for the restatement check.
  const [studentMessageSent, setStudentMessageSent] = useState("");
  // The page's status region, and the differences panel to focus once a
  // step's results are on the page.
  const [liveMessage, setLiveMessage] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ step: ResultStep; n: number } | null>(null);
  // The visitor's remaining allowance, read from the generate route's budget
  // arm on load and after every step. Null until read, or when the route has
  // no per-visitor limit.
  const [allowance, setAllowance] = useState<DemoBudgetResponse | null>(null);
  // A step refused before it started, for lack of allowance.
  const [refusal, setRefusal] = useState<{ place: RefusalPlace; message: string } | null>(null);
  // A column's request refused mid-step; shown inside that column.
  const [notices, setNotices] = useState<Record<"left" | "right", Partial<Record<Scene, string>>>>({
    left: {},
    right: {},
  });
  const [focusRunButton, setFocusRunButton] = useState(0);
  // True while the allowance is read before a step, so that the step's
  // control cannot be pressed twice in that moment.
  const [checking, setChecking] = useState(false);

  const hintsRef = useRef<HintItem[]>([]);
  const runIdRef = useRef(0);
  const stopRef = useRef(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Resolves the guided run's wait for Next.
  const nextRef = useRef<(() => void) | null>(null);
  // Resolves the guided run's wait after a failed step.
  const retryRef = useRef<((choice: "retry" | "stop") => void) | null>(null);
  // Why the last step started by the guided run did not complete, as the rest
  // of "Step n stopped: ...". Set by each step's function when it fails.
  const stepErrorRef = useRef<string | null>(null);
  const spotlightTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // The last student message and its case, for "Ask again".
  const lastSentRef = useRef<{ text: string; source: SourceKind } | null>(null);
  const guidedRef = useRef(false);
  const seedCaseRequested = useRef(false);
  const paceRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  // The columns as last rendered, so that a step started from an earlier
  // render (the guided run's) can put back what was on the page before it.
  const leftRef = useRef(left);
  const rightRef = useRef(right);
  const retrievalRef = useRef(retrieval);
  useEffect(() => {
    leftRef.current = left;
    rightRef.current = right;
    retrievalRef.current = retrieval;
  }, [left, right, retrieval]);
  // Resolves the guided run's wait for the last row of the trace to appear.
  const revealWaiter = useRef<(() => void) | null>(null);

  // A 429 turns the buttons off until its retry time has passed.
  useEffect(() => {
    if (!block) return;
    const t = setTimeout(() => setBlock(null), block.ms);
    return () => clearTimeout(t);
  }, [block]);

  // The allowance, read once on load (no cost).
  const readAllowanceOnLoad = useEffectEvent(() => {
    if (!paused) void readAllowance();
  });
  useEffect(() => {
    readAllowanceOnLoad();
  }, []);

  // While the step banner is shown it covers the top of the viewport under the
  // site header, so the page's scroll padding is set to the two heights: the
  // browser then scrolls a focused control clear of them. The height is
  // measured as it changes (the caption wraps on a phone) and kept in
  // --demo-banner-h.
  const bannerShown = banner !== null;
  useEffect(() => {
    const el = bannerRef.current;
    if (!bannerShown || !el) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--demo-banner-h", `${siteHeaderHeight() + el.offsetHeight}px`);
      root.style.scrollPaddingTop = "calc(var(--demo-banner-h) + 8px)";
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--demo-banner-h");
      root.style.scrollPaddingTop = "";
    };
  }, [bannerShown]);

  // After Stop (or a guided step that could not run), focus the run button
  // once it is back on the page.
  useEffect(() => {
    if (focusRunButton === 0) return;
    const frame = requestAnimationFrame(() => runButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusRunButton]);

  const preset = PRESETS.find((p) => p.id === form.presetId) ?? PRESETS[0];
  const team = preset.teams[form.teamIndex];
  const blocked = block !== null;

  const drafting = left.draft.status === "loading" || right.draft.status === "loading";
  const personalising = left.variant.status === "loading" || right.variant.status === "loading";
  const answering = left.student.status === "loading" || right.student.status === "loading";
  const busy =
    retrieving || drafting || regenerating !== null || personalising || answering || checking;
  const controlsOff = paused || blocked || busy || scriptRunning;

  const leftDraft = left.draft.status === "done" ? left.draft.data : null;
  const rightDraft = right.draft.status === "done" ? right.draft.data : null;
  const rightContent =
    rightDraft && rightDraft.result.kind === "structured" ? rightDraft.result.content : null;
  // The concepts the check flags in the PersCase draft on the page, and the
  // section a regeneration would rewrite for them.
  const flagged =
    rightDraft && rightDraft.result.arm === "perscase" ? rightDraft.result.signals.conceptsMissing : [];
  const sectionForFlagged =
    rightContent && flagged.length > 0 ? sectionToRegenerate(rightContent, flagged) : null;
  // The PersCase draft as generated: its readings from before any
  // regeneration, for the draft step's cards.
  const rightAtGeneration = useMemo(
    () =>
      rightDraft?.beforeRegenerate
        ? {
            ...rightDraft,
            result: { ...rightDraft.result, signals: rightDraft.beforeRegenerate.signals } as GenerateResult,
          }
        : rightDraft,
    [rightDraft],
  );

  // What differs between the columns at each step, from the results on the
  // page. The guided run counts the same cards to set its pause.
  const retrievalCards = useMemo(
    () => computeDifferences({ step: "retrieval", trace: retrieval?.trace ?? null }),
    [retrieval],
  );
  const draftCards = useMemo(
    () =>
      leftDraft && rightAtGeneration
        ? computeDifferences({
            step: "draft",
            left: leftDraft,
            right: rightAtGeneration,
            baseline: leftDraft.result.arm as BaselineArm,
          })
        : [],
    [leftDraft, rightAtGeneration],
  );
  const regenerateCards = useMemo(
    () =>
      rightDraft?.beforeRegenerate && rightDraft.regeneration
        ? computeDifferences({
            step: "regenerate",
            section: rightDraft.regeneration.section,
            before: rightDraft.beforeRegenerate.signals,
            after: rightDraft.result.signals,
            regenerations: rightDraft.regeneration.count,
          })
        : [],
    [rightDraft],
  );
  const leftVariantData = left.variant.status === "done" ? left.variant.data : null;
  const rightVariantData = right.variant.status === "done" ? right.variant.data : null;
  const variantCards = useMemo(
    () =>
      leftVariantData && rightVariantData
        ? computeDifferences({
            step: "variant",
            left: leftVariantData,
            right: rightVariantData,
            baseline: leftDraft ? (leftDraft.result.arm as BaselineArm) : baseline,
            leftDraftText: leftDraft ? draftTextOf(leftDraft.result) : undefined,
            rightDraftText: rightDraft ? draftTextOf(rightDraft.result) : undefined,
          })
        : [],
    [leftVariantData, rightVariantData, leftDraft, rightDraft, baseline],
  );
  const leftStudentData = left.student.status === "done" ? left.student.data : null;
  const rightStudentData = right.student.status === "done" ? right.student.data : null;
  const studentCaseText = studentSourceSent === "generated" ? rightContent?.scenario : seedCaseText;
  const studentCards = useMemo(
    () =>
      leftStudentData && rightStudentData
        ? computeDifferences({
            step: "student",
            left: leftStudentData,
            right: rightStudentData,
            baseline,
            caseText: studentCaseText,
            studentMessage: studentMessageSent,
          })
        : [],
    [leftStudentData, rightStudentData, baseline, studentCaseText, studentMessageSent],
  );

  // Focus the differences panel of the step whose results just arrived (or
  // the columns, when the panel has no cards). The guided run does its own
  // scrolling, so focus does not scroll then.
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      const id = `differences-${focusRequest.step}`;
      const el =
        document.getElementById(id) ??
        (SCROLL_FALLBACKS[id] ? document.getElementById(SCROLL_FALLBACKS[id]) : null);
      if (!el) return;
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      if (!guidedRef.current) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  // The seeded case's discussion questions and task, read once on load (the
  // "case" arm: no model call, no cost). Reading it on load rather than when
  // the student scene opens means that nothing in the student scene sends a
  // request except Send and "Ask for hint n of 3".
  const readSeedCaseOnLoad = useEffectEvent(() => {
    if (seedCaseRequested.current || paused) return;
    seedCaseRequested.current = true;
    void postJson<DemoStudentCaseResponse>("/api/demo/student", {
      arm: "case",
      source: { kind: "seed", id: SEEDED_FINANCE_CASE_ID },
      phaseId: FINANCE_LAST_PHASE.id,
    }).then((o) => {
      if (o.ok) {
        setSeedCase({ status: "done", data: o.data });
        setSeedCaseText(o.data.caseText);
      } else {
        setSeedCase({ status: "error", message: o.message });
      }
    });
  });
  useEffect(() => {
    readSeedCaseOnLoad();
  }, []);

  // The "Demo complete" line leaves the banner's place after DONE_NOTICE_MS.
  useEffect(() => {
    if (!doneNotice) return;
    const t = setTimeout(() => setDoneNotice(false), DONE_NOTICE_MS);
    return () => clearTimeout(t);
  }, [doneNotice]);

  // A new variant scrolls each column's box to its heading; a new reply scrolls
  // to the reply. These parent effects run after the column's own scroll back
  // to the top and after the new result (and its typewriter) has mounted.
  const leftVariantRun = runIdOf(left.variant);
  const rightVariantRun = runIdOf(right.variant);
  const leftStudentRun = runIdOf(left.student);
  const rightStudentRun = runIdOf(right.student);
  useEffect(() => {
    if (leftVariantRun !== null) return scrollBoxTo("left-variant", "left-instructor");
  }, [leftVariantRun]);
  useEffect(() => {
    if (rightVariantRun !== null) return scrollBoxTo("right-variant", "right-instructor");
  }, [rightVariantRun]);
  useEffect(() => {
    if (leftStudentRun !== null) return scrollBoxTo("left-reply", "left-student");
  }, [leftStudentRun]);
  useEffect(() => {
    if (rightStudentRun !== null) return scrollBoxTo("right-reply", "right-student");
  }, [rightStudentRun]);

  // The concepts in the order the marks number them: the drafts' brief, or
  // the form's before anything is generated.
  const legendConcepts = (rightDraft ?? leftDraft)?.brief.mustCoverConcepts ??
    form.brief.mustCoverConcepts.map((c) => c.trim()).filter(Boolean);

  const reached = [
    retrieval !== null,
    leftDraft !== null && rightDraft !== null,
    !!rightDraft?.beforeRegenerate,
    left.variant.status === "done" && right.variant.status === "done",
    studentReached.hint || hints.length > 0,
    studentReached.feedback,
  ];
  // "Fix a missed concept" is not needed when the PersCase draft, as
  // generated, has every must-cover concept.
  const notNeeded = STEPS.map(
    (_, i) =>
      i === 2 &&
      rightDraft !== null &&
      !rightDraft.beforeRegenerate &&
      rightDraft.result.signals.conceptsMissing.length === 0,
  );

  const brief = form.brief;
  const profile = brief.targetLearnerProfile;
  const briefReady =
    brief.learningObjective.trim().length >= 10 &&
    profile.industry.trim() !== "" &&
    profile.role.trim() !== "" &&
    profile.priorKnowledge.trim() !== "";

  function nextRunId(): number {
    runIdRef.current += 1;
    return runIdRef.current;
  }

  // Records what a failed request means for the page and returns its message.
  function failure(o: { message: string; retryAfterSec?: number; paused?: boolean }): string {
    if (o.paused) setPaused(true);
    if (o.retryAfterSec && o.retryAfterSec > 0) setBlock({ ms: o.retryAfterSec * 1000 });
    return o.message;
  }

  // Says through the status region that a step's results are in, and asks for
  // the step's differences panel to take focus. Setting the text again after
  // clearing it makes a repeated message heard again.
  function announceResults(step: ResultStep, bothOk: boolean) {
    const text = bothOk ? READY_MESSAGES[step] : "One of the two columns returned an error";
    setLiveMessage("");
    requestAnimationFrame(() => setLiveMessage(text));
    setFocusRequest((f) => ({ step, n: (f?.n ?? 0) + 1 }));
  }

  function resetHints() {
    hintsRef.current = [];
    setHints([]);
  }

  // The allowance

  async function readAllowance(): Promise<DemoBudgetResponse | null> {
    const o = await postJson<DemoBudgetResponse>("/api/demo/generate", { arm: "budget" });
    if (!o.ok) {
      if (o.paused) setPaused(true);
      return null;
    }
    setAllowance(o.data);
    return o.data;
  }

  // Reads the allowance afresh and refuses an action that costs more than is
  // left, with the wait until it refills. When the allowance cannot be read,
  // the action goes ahead and the route's own limit applies.
  async function haveAllowance(cost: number, place: RefusalPlace): Promise<boolean> {
    setChecking(true);
    const a = await readAllowance().finally(() => setChecking(false));
    if (a && a.remaining !== null && a.remaining < cost) {
      const message = refusalMessage(a.retryAfterSec);
      setRefusal({ place, message });
      stepErrorRef.current = asClause(message);
      return false;
    }
    setRefusal(null);
    return true;
  }

  function setNotice(side: "left" | "right", sceneId: Scene, message: string | null) {
    setNotices((n) => {
      const next = { ...n[side] };
      if (message) next[sceneId] = message;
      else delete next[sceneId];
      return { ...n, [side]: next };
    });
  }

  function clearNotices(sceneId: Scene) {
    setNotice("left", sceneId, null);
    setNotice("right", sceneId, null);
  }

  // Undoes a step one of whose requests was refused for lack of allowance:
  // both columns get back what they showed before it, and the refused column
  // says why.
  function undoRefusedStep(
    sceneId: Scene,
    before: { left: ColumnState; right: ColumnState },
    refused: { left: boolean; right: boolean },
  ) {
    const keys: (keyof ColumnState)[] = sceneId === "instructor" ? ["draft", "variant"] : ["student"];
    const restore = (prev: ColumnState) => (c: ColumnState) => {
      const out = { ...c };
      for (const k of keys) (out as Record<string, unknown>)[k] = prev[k];
      return out;
    };
    setLeft(restore(before.left));
    setRight(restore(before.right));
    if (refused.left) setNotice("left", sceneId, ALLOWANCE_NOTICE);
    if (refused.right) setNotice("right", sceneId, ALLOWANCE_NOTICE);
    stepErrorRef.current =
      "the allowance ran out during this step, so a request was refused; both columns keep their results from before it.";
    setLiveMessage("");
    requestAnimationFrame(() =>
      setLiveMessage("The allowance ran out during this step; the results from before it are kept"),
    );
  }

  // When the notes on the page and the drafts or the form are for different
  // briefs, a line under the trace says which.
  const formBrief = cleanBrief(form.brief);
  const retrievalNote = !retrieval
    ? null
    : !sameBrief(retrieval.brief, formBrief)
      ? "The brief has changed since these notes were retrieved; Generate retrieves again."
      : rightDraft && !sameBrief(retrieval.brief, rightDraft.brief)
        ? "The PersCase draft below was written from an earlier brief; Generate writes one from these notes."
        : null;

  // The brief on the form is the one the PersCase draft came from, and only
  // the baseline has changed since: Generate then reruns the standard LLM
  // column alone, so that the new baseline is compared with the same PersCase
  // draft rather than a new one.
  const leftOnly =
    leftDraft !== null &&
    rightDraft !== null &&
    leftDraft.result.arm !== baseline &&
    sameBrief(formBrief, rightDraft.brief);

  // The notes retrieved for a brief, when the page holds them.
  function retrievalFor(runBrief: CaseInput): RetrievalData | null {
    const r = retrievalRef.current;
    return r && sameBrief(r.brief, runBrief) ? r : null;
  }

  // Instructor, the retrieval step on its own: one embedding call and no model
  // call. The notes it shows are the ones the PersCase draft of the same brief
  // is then generated from. In a guided run the notes are revealed one by one.
  async function retrieveNotes(opts: { guided?: boolean } = {}): Promise<RetrievalData | null> {
    if (!(await haveAllowance(ACTION_COST.retrieve, opts.guided ? "run" : "instructor"))) return null;
    const runBrief = cleanBrief(form.brief);
    setRetrievalError(null);
    setRetrieving(true);
    const o = await postJson<Extract<DemoGenerateResponse, { arm: "retrieve" }>>("/api/demo/generate", {
      arm: "retrieve",
      brief: runBrief,
    });
    setRetrieving(false);
    void readAllowance();
    if (!o.ok) {
      const msg = failure(o);
      setRetrievalError(msg);
      stepErrorRef.current = asClause(msg);
      return null;
    }
    const data: RetrievalData = {
      brief: runBrief,
      trace: o.data.retrieval,
      provenance: o.data.provenance,
      runId: nextRunId(),
      staged: !!opts.guided,
    };
    retrievalRef.current = data;
    setRetrieval(data);
    // A PersCase error from before these notes no longer applies to them.
    setRight((c) => (c.draft.status === "error" ? { ...c, draft: IDLE } : c));
    return data;
  }

  // Instructor: both drafts at once, then the baseline's readings again against
  // the notes the PersCase draft retrieved. PersCase is generated from the
  // notes retrieved for this brief (`notes`, or the ones on the page); when
  // there are none, retrieval runs first, as the retrieval step would.
  async function generate(
    opts: { guided?: boolean; notes?: RetrievalData } = {},
  ): Promise<{ left: DraftData; right: DraftData } | null> {
    if (!opts.guided && leftOnly && rightDraft) return generateLeft(rightDraft);
    const runBrief = cleanBrief(form.brief);
    const given = opts.notes ?? retrievalFor(runBrief);
    const cost = given ? ACTION_COST.generateFromNotes : ACTION_COST.generateBoth;
    if (!(await haveAllowance(cost, opts.guided ? "run" : "instructor"))) return null;
    const arm = baseline;
    const before = { left: leftRef.current, right: rightRef.current, retrieval: retrievalRef.current };
    clearNotices("instructor");
    setRetrievalError(null);
    setRegenerateError(null);
    setLeft((c) => ({ ...c, draft: LOADING, variant: IDLE }));
    setRight((c) => ({ ...c, draft: LOADING, variant: IDLE }));

    // The baseline starts at once. PersCase generates from exactly the notes
    // the trace shows, retrieving them first when the page has none.
    const leftPending = postJson<GenerateResult>("/api/demo/generate", { arm, brief: runBrief });
    const rightPending = (async () => {
      let notes = given;
      if (!notes) {
        setRetrieving(true);
        const ret = await postJson<Extract<DemoGenerateResponse, { arm: "retrieve" }>>(
          "/api/demo/generate",
          { arm: "retrieve", brief: runBrief },
        );
        setRetrieving(false);
        if (!ret.ok && (ret.paused || ret.status === 429)) return ret;
        if (ret.ok) {
          const data: RetrievalData = {
            brief: runBrief,
            trace: ret.data.retrieval,
            provenance: ret.data.provenance,
            runId: nextRunId(),
            staged: false,
          };
          notes = data;
          retrievalRef.current = data;
          setRetrieval(data);
        }
      }
      const gen = await postJson<GenerateResult>("/api/demo/generate", {
        arm: "perscase",
        brief: runBrief,
        // Without notes (the retrieval request failed), the arm retrieves
        // for itself.
        ...(notes ? { provenance: notes.provenance } : {}),
      });
      if (!gen.ok || gen.data.arm !== "perscase") return gen;
      // The arm's own trace has no left-out note when it was given the notes;
      // the retrieve arm's trace has it, for the same notes.
      if (notes) return { ...gen, data: { ...gen.data, retrieval: notes.trace } };
      // The arm retrieved for itself: its trace becomes the retrieval step's.
      const own: RetrievalData = {
        brief: runBrief,
        trace: gen.data.retrieval,
        provenance: gen.data.provenance,
        runId: nextRunId(),
        staged: false,
      };
      retrievalRef.current = own;
      setRetrieval(own);
      return gen;
    })();
    const [l, r] = await Promise.all([leftPending, rightPending]);

    if (refusedForAllowance(l) || refusedForAllowance(r)) {
      if (!l.ok) failure(l);
      if (!r.ok) failure(r);
      undoRefusedStep("instructor", before, {
        left: refusedForAllowance(l),
        right: refusedForAllowance(r),
      });
      retrievalRef.current = before.retrieval;
      setRetrieval(before.retrieval);
      void readAllowance();
      return null;
    }
    if (source === "generated") {
      resetHints();
      setSource("seed");
    }

    let leftData: DraftData | null = null;
    let rightData: DraftData | null = null;
    if (l.ok) {
      leftData = { result: l.data, brief: runBrief, aligned: false, runId: nextRunId() };
      const d = leftData;
      setLeft((c) => ({ ...c, draft: { status: "done", data: d } }));
    } else {
      const msg = failure(l);
      setLeft((c) => ({ ...c, draft: { status: "error", message: msg } }));
    }
    if (r.ok) {
      rightData = { result: r.data, brief: runBrief, aligned: true, runId: nextRunId() };
      const d = rightData;
      setRight((c) => ({ ...c, draft: { status: "done", data: d } }));
    } else {
      const msg = failure(r);
      setRight((c) => ({ ...c, draft: { status: "error", message: msg } }));
    }
    announceResults("draft", !!leftData && !!rightData);
    void readAllowance();
    if (!leftData || !rightData) {
      stepErrorRef.current = twoColumnFailure(
        "draft",
        l.ok ? null : l.message,
        r.ok ? null : r.message,
      );
      return null;
    }
    leftData = await alignBaseline(leftData, rightData);
    return { left: leftData, right: rightData };
  }

  // The baseline's readings against the notes the PersCase draft retrieved
  // (the signals arm: no model call, no cost). Replaces the left draft's
  // result object only if no newer run has replaced the draft meanwhile.
  async function alignBaseline(leftData: DraftData, rightData: DraftData): Promise<DraftData> {
    const lr = leftData.result;
    const s = await postJson<{ arm: "signals"; signals: ArmSignals }>("/api/demo/generate", {
      arm: "signals",
      brief: rightData.brief,
      provenance: rightData.result.provenance,
      ...(lr.kind === "text" ? { text: lr.text } : { content: lr.content }),
    });
    if (!s.ok) {
      failure(s);
      return leftData;
    }
    const aligned: DraftData = {
      ...leftData,
      result: { ...lr, signals: s.data.signals } as GenerateResult,
      aligned: true,
    };
    setLeft((c) =>
      c.draft.status === "done" && c.draft.data.runId === aligned.runId
        ? { ...c, draft: { status: "done", data: aligned } }
        : c,
    );
    return aligned;
  }

  // Instructor, after the baseline was switched: the standard LLM column only,
  // on the brief of the PersCase draft, whose draft, trace and provenance stay
  // as they are. The left variant, made from the old baseline's draft, goes.
  async function generateLeft(rightData: DraftData): Promise<{ left: DraftData; right: DraftData } | null> {
    if (!(await haveAllowance(ACTION_COST.generateLeft, "instructor"))) return null;
    const runBrief = rightData.brief;
    const arm = baseline;
    const before = { left: leftRef.current, right: rightRef.current };
    clearNotices("instructor");
    setLeft((c) => ({ ...c, draft: LOADING, variant: IDLE }));
    const l = await postJson<GenerateResult>("/api/demo/generate", { arm, brief: runBrief });
    if (refusedForAllowance(l)) {
      if (!l.ok) failure(l);
      undoRefusedStep("instructor", before, { left: true, right: false });
      void readAllowance();
      return null;
    }
    let leftData: DraftData | null = null;
    if (l.ok) {
      leftData = { result: l.data, brief: runBrief, aligned: false, runId: nextRunId() };
      const d = leftData;
      setLeft((c) => ({ ...c, draft: { status: "done", data: d } }));
    } else {
      const msg = failure(l);
      setLeft((c) => ({ ...c, draft: { status: "error", message: msg } }));
    }
    announceResults("draft", !!leftData);
    void readAllowance();
    if (!leftData) {
      stepErrorRef.current = twoColumnFailure("draft", l.ok ? null : l.message, null);
      return null;
    }
    leftData = await alignBaseline(leftData, rightData);
    return { left: leftData, right: rightData };
  }

  // Instructor, the remedy for a flagged concept, as the instructor's editor
  // offers it: one section of the PersCase draft regenerated with the flagged
  // concepts named, from the notes the draft was generated from, and the check
  // run again on the result. The standard column has no check and so nothing
  // to regenerate. The PersCase variant, written from the old draft, goes.
  async function regenerate(given?: DraftData): Promise<DraftData | null> {
    const d = given ?? rightDraft;
    if (!d) return null;
    const r = d.result;
    if (r.arm !== "perscase" || r.signals.conceptsMissing.length === 0) return null;
    if (!(await haveAllowance(ACTION_COST.regenerate, given ? "run" : "instructor"))) return null;
    const missing = r.signals.conceptsMissing;
    const section = sectionToRegenerate(r.content, missing);
    clearNotices("instructor");
    setRegenerateError(null);
    setRegenerating(section);
    const o = await postJson<DemoRegenerateResponse>("/api/demo/generate", {
      arm: "regenerate",
      brief: d.brief,
      content: r.content,
      provenance: r.provenance,
      section,
      missingConcepts: missing,
    });
    setRegenerating(null);
    void readAllowance();
    if (!o.ok) {
      const msg = failure(o);
      setRegenerateError(msg);
      stepErrorRef.current = asClause(msg);
      announceResults("regenerate", false);
      return null;
    }
    const next: DraftData = {
      ...d,
      result: { ...r, content: o.data.content, signals: o.data.signals },
      runId: nextRunId(),
      beforeRegenerate: d.beforeRegenerate ?? { signals: r.signals, elapsedMs: r.elapsedMs },
      regeneration: {
        section,
        modelId: o.data.modelId,
        elapsedMs: o.data.elapsedMs,
        count: (d.regeneration?.count ?? 0) + 1,
      },
    };
    setRight((c) =>
      c.draft.status === "done" && c.draft.data.runId === d.runId
        ? { ...c, draft: { status: "done", data: next }, variant: IDLE }
        : c,
    );
    announceResults("regenerate", true);
    return next;
  }

  // Instructor: one variant per column, each from that column's own draft.
  async function personalise(given?: {
    left: DraftData;
    right: DraftData;
  }): Promise<{ left: VariantData; right: VariantData } | null> {
    const l = given?.left ?? leftDraft;
    const r = given?.right ?? rightDraft;
    if (!l || !r || r.result.kind !== "structured") return null;
    if (!(await haveAllowance(ACTION_COST.personalise, given ? "run" : "instructor"))) return null;
    const runBrief = r.brief;
    const teamNow = team;
    const rightBase = toCaseContent(r.result.content);
    // Each column personalises its own draft. A plain draft is free text and
    // goes to the route as text.
    const leftBase =
      l.result.kind === "structured" ? toCaseContent(l.result.content) : { text: l.result.text };

    const before = { left: leftRef.current, right: rightRef.current };
    clearNotices("instructor");
    setLeft((c) => ({ ...c, variant: LOADING }));
    setRight((c) => ({ ...c, variant: LOADING }));
    const [lv, rv] = await Promise.all([
      postJson<PersonaliseResult>("/api/demo/personalise", {
        arm: "plain",
        brief: runBrief,
        base: leftBase,
        team: teamNow,
      }),
      postJson<PersonaliseResult>("/api/demo/personalise", {
        arm: "perscase",
        brief: runBrief,
        base: rightBase,
        team: teamNow,
      }),
    ]);
    if (refusedForAllowance(lv) || refusedForAllowance(rv)) {
      if (!lv.ok) failure(lv);
      if (!rv.ok) failure(rv);
      undoRefusedStep("instructor", before, {
        left: refusedForAllowance(lv),
        right: refusedForAllowance(rv),
      });
      void readAllowance();
      return null;
    }
    let leftData: VariantData | null = null;
    let rightData: VariantData | null = null;
    if (lv.ok) {
      const d: VariantData = { result: lv.data, team: teamNow, runId: nextRunId() };
      leftData = d;
      setLeft((c) => ({ ...c, variant: { status: "done", data: d } }));
    } else {
      const msg = failure(lv);
      setLeft((c) => ({ ...c, variant: { status: "error", message: msg } }));
    }
    if (rv.ok) {
      const d: VariantData = { result: rv.data, team: teamNow, runId: nextRunId() };
      rightData = d;
      setRight((c) => ({ ...c, variant: { status: "done", data: d } }));
    } else {
      const msg = failure(rv);
      setRight((c) => ({ ...c, variant: { status: "error", message: msg } }));
    }
    announceResults("variant", !!leftData && !!rightData);
    void readAllowance();
    if (!leftData || !rightData) {
      stepErrorRef.current = twoColumnFailure(
        "variant",
        lv.ok ? null : lv.message,
        rv.ok ? null : rv.message,
      );
      return null;
    }
    return { left: leftData, right: rightData };
  }

  // The discussion questions of the case the student scene answers, when the
  // page holds them.
  function questionsOf(kind: SourceKind): string[] | null {
    if (kind === "generated") return rightContent?.discussionQuestions ?? null;
    return seedCase.status === "done" ? seedCase.data.discussionQuestions : null;
  }

  // Student: the same message to both arms, as a hint request or for feedback.
  // With onlyRight (the "Ask for hint n of 3" button), only the PersCase column
  // asks, for its next hint, and the standard LLM reply stays as it is.
  async function send(
    text: string,
    forceSource?: SourceKind,
    opts: { onlyRight?: boolean; guided?: boolean } = {},
  ): Promise<{ left: StudentData; right: StudentData } | null> {
    const msg = text.trim();
    if (!msg) return null;
    const mode = opts.onlyRight ? "hint" : studentMode(msg);
    const kind = forceSource ?? source;
    let src: { kind: "seed"; id: string } | { kind: "content"; content: CaseContent };
    let phaseId: string | undefined;
    if (kind === "generated") {
      if (!rightContent) return null;
      src = { kind: "content", content: toCaseContent(rightContent) };
    } else {
      src = { kind: "seed", id: SEEDED_FINANCE_CASE_ID };
      phaseId = FINANCE_LAST_PHASE.id;
    }
    const cost = opts.onlyRight ? ACTION_COST.hint : ACTION_COST.send;
    if (!(await haveAllowance(cost, opts.guided ? "run" : "student"))) return null;

    // A hint request that names a discussion question is about that question:
    // PersCase gets the question's index and no phase (the route adds the
    // question's text). A number past the questions the page holds is not
    // sent; when the page does not hold them, the route ignores such a number.
    const named = namedQuestionNumber(msg);
    const questions = questionsOf(kind);
    const questionIndex =
      mode === "hint" && named !== null && (questions === null || named <= questions.length)
        ? named - 1
        : undefined;
    const previousHints = hintsRef.current.map((h) => h.hint);

    const before = { left: leftRef.current, right: rightRef.current };
    clearNotices("student");
    setStudentModePending(mode);
    if (!opts.onlyRight) setLeft((c) => ({ ...c, student: LOADING }));
    setRight((c) => ({ ...c, student: LOADING }));
    const leftPending: Promise<ApiOutcome<StudentResult> | null> = opts.onlyRight
      ? Promise.resolve(null)
      : postJson<StudentResult>("/api/demo/student", { arm: "plain", mode, source: src, phaseId, message: msg });
    const [l, r] = await Promise.all([
      leftPending,
      postJson<StudentResult>("/api/demo/student", {
        arm: "perscase",
        mode,
        source: src,
        ...(questionIndex !== undefined ? { questionIndex } : { phaseId }),
        message: msg,
        ...(mode === "hint" ? { previousHints } : {}),
      }),
    ]);
    setStudentModePending(null);
    if ((l && refusedForAllowance(l)) || refusedForAllowance(r)) {
      if (l && !l.ok) failure(l);
      if (!r.ok) failure(r);
      undoRefusedStep("student", before, {
        left: !!l && refusedForAllowance(l),
        right: refusedForAllowance(r),
      });
      void readAllowance();
      return null;
    }

    lastSentRef.current = { text: msg, source: kind };
    setStudentModeSent(mode);
    if (!opts.onlyRight) {
      setStudentSourceSent(kind);
      setStudentMessageSent(msg);
    }
    let leftData: StudentData | null =
      opts.onlyRight && before.left.student.status === "done" ? before.left.student.data : null;
    let rightData: StudentData | null = null;
    if (kind === "seed") {
      const caseText = (r.ok ? r.data.caseText : undefined) ?? (l?.ok ? l.data.caseText : undefined);
      if (caseText) setSeedCaseText(caseText);
    }
    if (l) {
      if (l.ok) {
        const d: StudentData = { result: l.data, runId: nextRunId() };
        leftData = d;
        setLeft((c) => ({ ...c, student: { status: "done", data: d } }));
      } else {
        const m = failure(l);
        setLeft((c) => ({ ...c, student: { status: "error", message: m } }));
      }
    }
    if (r.ok) {
      const result = r.data;
      if (result.arm === "perscase" && result.mode === "hint") {
        const next = [...hintsRef.current, {
          hint: result.hint,
          levelName: result.levelName,
          index: result.index,
          total: result.total,
        }];
        hintsRef.current = next;
        setHints(next);
      }
      const d: StudentData = { result, runId: nextRunId() };
      rightData = d;
      setRight((c) => ({ ...c, student: { status: "done", data: d } }));
      setStudentReached((sr) => (sr[mode] ? sr : { ...sr, [mode]: true }));
    } else {
      const m = failure(r);
      setRight((c) => ({ ...c, student: { status: "error", message: m } }));
    }
    announceResults("student", !!leftData && !!rightData);
    void readAllowance();
    if (!leftData || !rightData) {
      stepErrorRef.current = twoColumnFailure(
        "reply",
        l && !l.ok ? l.message : null,
        r.ok ? null : r.message,
      );
      return null;
    }
    return { left: leftData, right: rightData };
  }

  // PersCase hint mode: the same message again, with the hints so far, for
  // the next hint, from the PersCase column only. Three at most.
  const showAskForHint =
    studentModeSent === "hint" &&
    right.student.status !== "idle" &&
    hints.length > 0 &&
    hints.length < DEMO_MAX_HINTS;
  function askForHint() {
    const last = lastSentRef.current;
    if (last) void send(last.text, last.source, { onlyRight: true });
  }

  // The guided run. Each step points at its control, runs, and scrolls to the
  // differences it produced; see guided-run.ts for the order of events.

  // While a step waits for the model, the columns' progress readouts are
  // brought into view once, after the control's spotlight.
  async function withProgressInView<T>(pending: Promise<T>, columnsId: string): Promise<T> {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) scrollToTarget(columnsId, "start");
    }, SPOTLIGHT_MS);
    try {
      return await pending;
    } finally {
      settled = true;
      clearTimeout(t);
    }
  }

  function spotlight(controlId: string, ms: number) {
    const el = document.querySelector<HTMLElement>(`[data-control="${controlId}"]`);
    if (!el) return;
    const timers = spotlightTimers.current;
    const previous = timers.get(controlId);
    if (previous) clearTimeout(previous);
    el.classList.add(...SPOTLIGHT_CLASSES);
    timers.set(
      controlId,
      setTimeout(() => {
        el.classList.remove(...SPOTLIGHT_CLASSES);
        timers.delete(controlId);
      }, ms),
    );
  }

  function guidedSteps(): GuidedStep<Scene>[] {
    const runBaseline = baseline;
    let notes: RetrievalData | null = null;
    let drafts: { left: DraftData; right: DraftData } | null = null;
    const student = async (text: string) => {
      setMessage(text);
      const replies = await withProgressInView(
        send(text, "seed", { guided: true }),
        "demo-columns-student",
      );
      if (!replies) return { ok: false };
      const cards = computeDifferences({
        step: "student",
        left: replies.left,
        right: replies.right,
        baseline: runBaseline,
        caseText: replies.right.result.caseText ?? replies.left.result.caseText,
        studentMessage: text,
      });
      return { ok: true, cardCount: cards.length };
    };
    return [
      {
        id: "retrieve",
        title: `retrieve the notes for the ${preset.label} brief`,
        sceneId: "instructor",
        controlId: "retrieve",
        resultId: "right-trace",
        action: async () => {
          // The notes appear one at a time. The trace is held in view from
          // when it arrives until the last line has appeared; the pause
          // before the next step then starts.
          const revealed = new Promise<void>((resolve) => {
            revealWaiter.current = resolve;
          });
          const r = await retrieveNotes({ guided: true });
          if (!r) {
            revealWaiter.current = null;
            return { ok: false };
          }
          notes = r;
          await afterRender();
          const stopHold = holdInView("right-trace");
          // A reveal that never reports (the panel was not rendered) does not
          // hold the run for longer than its own length and a margin.
          const limit = (r.trace.notes.length + 4) * STAGE_MS + 2000;
          await Promise.race([revealed, new Promise<void>((resolve) => setTimeout(resolve, limit))]);
          revealWaiter.current = null;
          stopHold();
          return { ok: true, cardCount: 1 };
        },
      },
      {
        id: "generate",
        title: "generate both drafts",
        sceneId: "instructor",
        controlId: "generate",
        resultId: "differences-draft",
        action: async () => {
          // PersCase is generated from the notes step 1 retrieved.
          drafts = await withProgressInView(
            generate({ guided: true, notes: notes ?? undefined }),
            "demo-columns-instructor",
          );
          if (!drafts) return { ok: false };
          const cards = computeDifferences({
            step: "draft",
            left: drafts.left,
            right: drafts.right,
            baseline: drafts.left.result.arm as BaselineArm,
          });
          return { ok: true, cardCount: cards.length };
        },
      },
      {
        // Runs only when the check flags a concept in the PersCase draft;
        // otherwise it is passed over and the strip marks it "not needed".
        // The section is chosen by sectionToRegenerate (lib/demo/regenerate.ts):
        // the discussion questions with their model answers, unless a flagged
        // concept is absent from the scenario as well, in which case the
        // scenario.
        id: "regenerate",
        title: () => {
          const r = drafts?.right.result;
          const missing = r?.signals.conceptsMissing ?? [];
          const section =
            r && r.kind === "structured" ? sectionToRegenerate(r.content, missing) : "discussionQuestions";
          return `fix the missed concept: regenerate the ${SECTION_NAMES[section]}`;
        },
        sceneId: "instructor",
        controlId: "regenerate",
        resultId: "differences-regenerate",
        skip: () => !drafts || drafts.right.result.signals.conceptsMissing.length === 0,
        skipNotice: {
          caption: () => fixNotNeeded(drafts?.right.result.signals.conceptsCovered.length ?? 0),
          ms: SKIP_NOTICE_MS,
        },
        action: async () => {
          const d = drafts;
          if (!d) return { ok: false };
          const right = await withProgressInView(regenerate(d.right), "demo-columns-instructor");
          if (!right) return { ok: false };
          // Personalisation then starts from the regenerated draft.
          drafts = { left: d.left, right };
          return { ok: true, cardCount: 1 };
        },
      },
      {
        id: "personalise",
        title: `personalise both drafts for ${team.displayName}`,
        sceneId: "instructor",
        controlId: "personalise",
        resultId: "differences-variant",
        action: async () => {
          const d = drafts;
          if (!d) return { ok: false };
          const variants = await withProgressInView(personalise(d), "demo-columns-instructor");
          if (!variants) return { ok: false };
          const cards = computeDifferences({
            step: "variant",
            left: variants.left,
            right: variants.right,
            baseline: d.left.result.arm as BaselineArm,
            leftDraftText: draftTextOf(d.left.result),
            rightDraftText: draftTextOf(d.right.result),
          });
          return { ok: true, cardCount: cards.length };
        },
      },
      {
        id: "student-ask",
        title: "as a student, on the example bank case (not the case above), ask for the answer",
        sceneId: "student",
        controlId: "send",
        resultId: "differences-student",
        action: async () => {
          setSource("seed");
          resetHints();
          return student(STUDENT_ASK_FOR_ANSWER);
        },
      },
      {
        id: "student-draft",
        title: "as a student, on the example bank case (not the case above), send an answer for feedback",
        sceneId: "student",
        controlId: "send",
        resultId: "differences-student",
        action: () => student(STUDENT_DRAFT_ANSWER),
      },
    ];
  }

  function releaseNext() {
    const resolve = nextRef.current;
    nextRef.current = null;
    resolve?.();
  }

  function stopGuidedRun() {
    stopRef.current = true;
    setStopping(true);
    releaseNext();
    answerAfterFailure("stop");
  }

  // "Retry this step" or "Stop" in the banner after a step failed.
  function answerAfterFailure(choice: "retry" | "stop") {
    const resolve = retryRef.current;
    retryRef.current = null;
    resolve?.(choice);
  }

  async function startGuidedRun(runPace: GuidedPace) {
    if (scriptRunning) return;
    stopRef.current = false;
    setStopping(false);
    setRunComplete(false);
    setDoneNotice(false);
    setStoppedAt(null);
    setScriptRunning(true);
    guidedRef.current = true;
    // Each step's failure carries the reason its function recorded.
    const steps = guidedSteps().map((st) => ({
      ...st,
      action: async () => {
        stepErrorRef.current = null;
        const r = await st.action();
        return r.ok ? r : { ...r, error: r.error ?? stepErrorRef.current ?? undefined };
      },
    }));
    // The step whose failure ended the run, for the line under the strip.
    const failed: { step: number | null } = { step: null };
    const guided = createGuidedRun<Scene>({
      steps,
      pace: runPace,
      hooks: {
        setScene,
        setBanner: (b) => {
          // null (the run's end) keeps the step that failed last.
          if (b) failed.step = b.failed ? b.step : null;
          setBanner(b);
        },
        spotlight,
        scrollTo: scrollToTarget,
        waitForNext: () =>
          new Promise<void>((resolve) => {
            nextRef.current = resolve;
          }),
        waitForRetry: () =>
          new Promise<"retry" | "stop">((resolve) => {
            retryRef.current = resolve;
          }),
        isStopped: () => stopRef.current,
      },
    });

    let outcome: Awaited<ReturnType<typeof guided.run>> = "failed";
    try {
      outcome = await guided.run();
      if (outcome === "done") {
        // The run ends on the student scene with the replies' differences in
        // view. The banner has just gone, which moves the page up by its
        // height, so the scroll waits for that render.
        setScene("student");
        setRunComplete(true);
        setDoneNotice(true);
        setLiveMessage("");
        requestAnimationFrame(() => setLiveMessage(DEMO_COMPLETE));
        setTimeout(() => scrollToTarget("differences-student", "start"), 80);
      } else if (outcome === "failed" && failed.step !== null) {
        setStoppedAt(failed.step);
      }
    } finally {
      nextRef.current = null;
      retryRef.current = null;
      guidedRef.current = false;
      setScriptRunning(false);
      setStopping(false);
      // After Stop, or a step that could not run, focus goes to the run
      // button rather than to the page body the banner leaves behind.
      if (outcome !== "done") setFocusRunButton((n) => n + 1);
    }
  }

  // ?run=1 and ?run=step: start once the page has rendered.
  const startFromUrl = useEffectEvent((runPace: GuidedPace) => {
    if (!paused && briefReady) void startGuidedRun(runPace);
  });
  useEffect(() => {
    if (!autorun) return;
    const t = setTimeout(() => startFromUrl(autorun), 600);
    return () => clearTimeout(t);
  }, [autorun]);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % SCENES.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + SCENES.length) % SCENES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SCENES.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setScene(SCENES[next].id);
    tabRefs.current[next]?.focus();
  }

  // The pace control is a radio group: one tab stop, arrows move and select.
  function onPaceKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % PACES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + PACES.length) % PACES.length;
    if (next < 0) return;
    e.preventDefault();
    setPace(PACES[next].id);
    paceRefs.current[next]?.focus();
  }

  function setBriefField(update: (b: CaseInput) => CaseInput) {
    setForm((f) => ({ ...f, brief: update(f.brief) }));
  }

  const modeNow = message.trim() ? studentMode(message) : null;
  // The discussion questions of the case selected in the student scene, and
  // the one the message names, shown above the message box.
  const currentQuestions = questionsOf(source);
  const namedN = namedQuestionNumber(message);
  const namedQuestion =
    namedN !== null && currentQuestions && namedN <= currentQuestions.length
      ? { n: namedN, text: currentQuestions[namedN - 1] }
      : null;
  const pausedBlock = (
    <p className="rounded-lg bg-flag/[0.08] px-4 py-5 text-sm font-medium text-flag ring-1 ring-inset ring-flag/20">
      The public demo is paused.
    </p>
  );
  // The first step not yet reached (and not passed over), drawn as the
  // current disc.
  const currentStep = reached.findIndex((r, i) => !r && !notNeeded[i]);
  const shortAllowance = allowance ? shortAllowanceText(allowance) : null;

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-semibold">Live demo</h1>
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">
              One brief, sent to a standard LLM and to PersCase side by side.
            </p>
          </div>
          <p className="max-w-3xl rounded-lg bg-flag/[0.08] px-4 py-3 text-sm leading-relaxed text-flag ring-1 ring-inset ring-flag/20">
            Public demo. The two columns run on the same input at the same time. Nothing you enter
            is stored, and no events are logged.
          </p>
        </div>

        {/* Six numbered discs joined by hairlines: a row from lg up, with the
            labels under the discs; a column below lg, with the labels beside
            them. A ticked disc is filled, the current one is outlined, and a
            step that was not needed is a hollow disc with a small label. */}
        <ol aria-label="Demo steps" className="flex flex-col lg:flex-row lg:items-start">
          {STEPS.map((label, i) => {
            const last = i === STEPS.length - 1;
            const done = reached[i];
            const skipped = notNeeded[i] && !done;
            const passed = (j: number) => reached[j] || notNeeded[j];
            const current = i === currentStep;
            return (
              <li
                key={label}
                className={cn(
                  "relative flex min-w-0 gap-3 pb-4 lg:flex-col lg:gap-2 lg:pb-0",
                  // The vertical hairline below lg, from under this disc to the next.
                  !last &&
                    "before:absolute before:bottom-0 before:left-[13.5px] before:top-7 before:w-px before:bg-border lg:before:hidden",
                  // From lg up every step has a cell of the same width, and its
                  // label wraps inside it rather than running into the next.
                  "lg:flex-1 lg:basis-0",
                  last && "pb-0",
                )}
              >
                <div className="flex items-center" aria-hidden="true">
                  <span
                    className={cn(
                      "relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums transition-colors",
                      done
                        ? "border-primary bg-primary text-primary-foreground"
                        : skipped
                          ? "border-primary bg-card text-transparent"
                          : current
                          ? "border-2 border-primary bg-card text-primary"
                          : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  {/* The horizontal hairline from lg up, from this disc to the next. */}
                  {!last ? (
                    <span
                      className={cn(
                        "hidden h-px min-w-4 flex-1 lg:block",
                        passed(i) && passed(i + 1) ? "bg-primary/50" : "bg-border",
                      )}
                    />
                  ) : null}
                </div>
                <span
                  className={cn(
                    "min-w-0 pt-1 text-sm leading-snug lg:pr-4 lg:pt-0",
                    done || current ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {skipped
                    ? fixNotNeeded(rightDraft?.result.signals.conceptsCovered.length ?? 0)
                    : label}
                </span>
                {reached[i] ? <span className="sr-only">(done)</span> : null}
              </li>
            );
          })}
        </ol>
        {runComplete && !scriptRunning ? (
          <p className="text-sm font-medium text-foreground">{DEMO_COMPLETE}</p>
        ) : null}
        {stoppedAt !== null && !scriptRunning ? (
          <p className="text-sm font-medium text-flag">
            The run stopped at step {stoppedAt}. The error is in the column that failed; Run the
            whole demo starts again from step 1.
          </p>
        ) : null}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {scriptRunning ? (
              // While the step banner shows, its own Stop button is the one to
              // use; a second one here would only repeat it.
              banner ? null : (
                <GuardedButton variant="secondary" onClick={stopGuidedRun} off={stopping}>
                  {stopping ? "Stopping after this step" : "Stop after this step"}
                </GuardedButton>
              )
            ) : (
              <GuardedButton
                ref={runButtonRef}
                variant="primary"
                onClick={() => void startGuidedRun(pace)}
                off={paused || blocked || busy || !briefReady}
              >
                Run the whole demo
              </GuardedButton>
            )}
            <div
              role="radiogroup"
              aria-label="Pace of the guided run"
              className="inline-flex rounded-full bg-muted p-1"
            >
              {PACES.map((p, i) => (
                <button
                  key={p.id}
                  ref={(el) => {
                    paceRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={pace === p.id}
                  tabIndex={pace === p.id ? 0 : -1}
                  disabled={scriptRunning}
                  onClick={() => setPace(p.id)}
                  onKeyDown={(e) => onPaceKey(e, i)}
                  className={cn(
                    "h-8 rounded-full px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted disabled:opacity-60",
                    pace === p.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted-hover hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {shortAllowance ? (
              <span className="text-[13px] tabular-nums text-muted-foreground">{shortAllowance}</span>
            ) : null}
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Retrieves the notes for the brief, generates both drafts, personalises them for the
            selected team, then sends a request for the answer and an answer for feedback in the
            student scene.{" "}
            {pace === "step"
              ? "Each step waits for Next."
              : "The page moves on by itself after each step."}
          </p>
          <RefusalLine refusal={refusal} place="run" />
          {blocked ? (
            <p role="status" className="text-[13px] text-flag">
              The buttons are off until the rate limit has passed.
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {signedIn ? (
              <Link
                href={`/admin/cases/${SEEDED_FINANCE_CASE_ID}/compare`}
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Open the contrastive view on the example finance case
              </Link>
            ) : (
              <Link
                href="/admin/login"
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                See the three-column contrastive view on a real case (sign in with admin / demo1234,
                the demonstration account)
              </Link>
            )}
          </p>
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {banner ? (
        // Sticky on this wrapper, not inside it: a sticky child can only
        // stick within its parent, and this wrapper is no taller than the banner.
        <div ref={bannerRef} data-step-banner className="sticky top-14 z-10 pt-2">
          <StepBanner
            banner={banner}
            onNext={releaseNext}
            onStop={stopGuidedRun}
            onRetry={() => answerAfterFailure("retry")}
            onEndAfterFailure={() => answerAfterFailure("stop")}
            stopping={stopping}
            stepMode={pace === "step"}
          />
        </div>
      ) : doneNotice ? (
        // data-step-banner: the scroll to the replies places them under it.
        <div data-step-banner className="sticky top-14 z-10 pt-2">
          <p className="rounded-lg border bg-card/95 px-4 py-3 text-sm font-semibold text-card-foreground shadow-md shadow-foreground/5 backdrop-blur">
            {DEMO_COMPLETE}
          </p>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Demo scene"
        className="flex w-full rounded-full bg-muted p-1 sm:inline-flex sm:w-auto"
      >
        {SCENES.map((s, i) => {
          const selected = scene === s.id;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`demo-tab-${s.id}`}
              data-control={`scene-${s.id}`}
              aria-selected={selected}
              aria-controls={`demo-panel-${s.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setScene(s.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={cn(
                "min-h-9 flex-1 rounded-full px-4 py-1.5 text-sm font-semibold leading-snug transition-[background-color,color,box-shadow] duration-150 sm:flex-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
                selected
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted-hover hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Both panels stay mounted, so a reveal in progress is not restarted by
          switching scenes. */}
      <div
        role="tabpanel"
        id="demo-panel-instructor"
        aria-labelledby="demo-tab-instructor"
        hidden={scene !== "instructor"}
        className="space-y-6"
      >
        <h2 className="sr-only">Instructor: create a personalised case</h2>
        <section
          aria-label="Brief"
          className="space-y-5 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-6"
        >
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
            <Field label="Brief" htmlFor="demo-preset">
              <select
                id="demo-preset"
                value={form.presetId}
                disabled={controlsOff}
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.id === e.target.value);
                  if (p) setForm(fromPreset(p));
                }}
                className={SELECT_CLASS}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Discipline">
              <p className="flex h-9 items-center text-sm">{DISCIPLINE_LABELS[brief.discipline]}</p>
            </Field>
            <div className="md:col-span-2">
              <Field label="Learning objective" htmlFor="demo-objective">
                <Textarea
                  id="demo-objective"
                  value={brief.learningObjective}
                  maxLength={OBJECTIVE_MAX}
                  rows={3}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBriefField((b) => ({ ...b, learningObjective: v }));
                  }}
                />
              </Field>
            </div>
            <Field label="Difficulty" htmlFor="demo-difficulty">
              <select
                id="demo-difficulty"
                value={brief.difficulty}
                onChange={(e) => {
                  const v = e.target.value as Difficulty;
                  setBriefField((b) => ({ ...b, difficulty: v }));
                }}
                className={SELECT_CLASS}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Industry" htmlFor="demo-industry">
              <Input
                id="demo-industry"
                value={profile.industry}
                maxLength={PROFILE_FIELD_MAX}
                onChange={(e) => {
                  const v = e.target.value;
                  setBriefField((b) => ({
                    ...b,
                    targetLearnerProfile: { ...b.targetLearnerProfile, industry: v },
                  }));
                }}
              />
            </Field>
            <Field label="Role" htmlFor="demo-role">
              <Input
                id="demo-role"
                value={profile.role}
                maxLength={PROFILE_FIELD_MAX}
                onChange={(e) => {
                  const v = e.target.value;
                  setBriefField((b) => ({
                    ...b,
                    targetLearnerProfile: { ...b.targetLearnerProfile, role: v },
                  }));
                }}
              />
            </Field>
            <Field label="Prior knowledge" htmlFor="demo-prior">
              <Input
                id="demo-prior"
                value={profile.priorKnowledge}
                maxLength={PROFILE_FIELD_MAX}
                onChange={(e) => {
                  const v = e.target.value;
                  setBriefField((b) => ({
                    ...b,
                    targetLearnerProfile: { ...b.targetLearnerProfile, priorKnowledge: v },
                  }));
                }}
              />
            </Field>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">
              Must-cover concepts (up to {MAX_CONCEPTS})
            </legend>
            <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {brief.mustCoverConcepts.map((c, i) => (
                <Input
                  key={i}
                  aria-label={`Must-cover concept ${i + 1}`}
                  value={c}
                  maxLength={CONCEPT_MAX}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBriefField((b) => ({
                      ...b,
                      mustCoverConcepts: b.mustCoverConcepts.map((x, j) => (j === i ? v : x)),
                    }));
                  }}
                />
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3 border-t pt-5">
            <GuardedButton
              variant="outline"
              data-control="retrieve"
              onClick={() => void retrieveNotes()}
              loading={retrieving && !drafting}
              off={controlsOff || !briefReady}
            >
              Retrieve notes
            </GuardedButton>
            <GuardedButton
              variant="outline"
              data-control="generate"
              onClick={() => void generate()}
              loading={drafting}
              off={controlsOff || !briefReady}
            >
              {leftOnly ? "Generate the standard LLM column" : "Generate"}
            </GuardedButton>
            <Field label="Team" htmlFor="demo-team">
              <select
                id="demo-team"
                value={form.teamIndex}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setForm((f) => ({ ...f, teamIndex: Number.isInteger(v) ? v : 0 }));
                }}
                className={SELECT_CLASS}
              >
                {preset.teams.map((t, i) => (
                  <option key={t.displayName} value={i}>
                    {t.displayName} ({t.role}, {t.industry})
                  </option>
                ))}
              </select>
            </Field>
            <GuardedButton
              variant="outline"
              data-control="personalise"
              // The label names the team and can be longer than a phone is wide.
              className="h-auto min-h-9 max-w-full whitespace-normal py-1.5 text-left"
              onClick={() => void personalise()}
              loading={personalising}
              off={controlsOff || !leftDraft || !rightContent}
            >
              Personalise for {team.displayName}
            </GuardedButton>
          </div>
          <RefusalLine refusal={refusal} place="instructor" />
        </section>

        {paused ? (
          pausedBlock
        ) : (
          <>
            <ReadingsStrip
              left={left.draft}
              right={right.draft}
              leftVariant={left.variant}
              rightVariant={right.variant}
            />

            <DifferencesPanel cards={draftCards} step="draft" title="What differs in the drafts" />
            <DifferencesPanel
              cards={regenerateCards}
              step="regenerate"
              title="What the regeneration changed"
            />
            <DifferencesPanel
              cards={variantCards}
              step="variant"
              title={`What differs in the variants for ${leftVariantData?.team.displayName ?? team.displayName}`}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground">
              <div className="space-y-1">
                <p>
                  <span className={cn(CONCEPT_MARK[0], "rounded px-1 text-foreground")}>highlighted</span>:
                  where a must-cover concept is present, one colour and number per concept ·{" "}
                  <span className={cn(NOTE_MARK, "text-foreground")}>underlined</span>: a retrieved-note
                  tag that counted as reflected
                </p>
                {legendConcepts.length > 0 ? (
                  <ul aria-label="Concept key" className="flex flex-wrap gap-x-3 gap-y-1">
                    {legendConcepts.map((c, i) => (
                      <li key={`${i}-${c}`}>
                        <span
                          className={cn(
                            CONCEPT_MARK[i % CONCEPT_MARK.length],
                            "rounded px-1 text-foreground",
                          )}
                        >
                          {c}
                        </span>
                        <ConceptIndex index={i} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  className="h-4 w-4 accent-primary"
                  type="checkbox"
                  checked={highlight}
                  onChange={(e) => setHighlight(e.target.checked)}
                />
                Highlight matches in the text
              </label>
            </div>

            <div id="demo-columns-instructor" className="grid gap-6 md:grid-cols-2">
              <Column
                title="Standard LLM"
                blurb={BASELINE_BLURBS[baseline]}
                scrollKey={resultKey(left.draft, left.variant)}
                notice={notices.left.instructor}
                control={
                  <label className="flex items-center gap-2 text-[13px] font-medium">
                    Baseline
                    <select
                      value={baseline}
                      disabled={controlsOff}
                      onChange={(e) => setBaseline(e.target.value as BaselineArm)}
                      className={cn(SELECT_CLASS, "h-8 w-auto text-[13px] font-normal")}
                    >
                      <option value="plain">{BASELINE_LABELS.plain}</option>
                      <option value="structured">{BASELINE_LABELS.structured}</option>
                    </select>
                  </label>
                }
              >
                {leftDraft && leftDraft.result.arm !== baseline ? (
                  <p className="text-[13px] text-muted-foreground">
                    This draft came from: {BASELINE_LABELS[leftDraft.result.arm as BaselineArm]}.
                    {leftOnly
                      ? " Generate now reruns this column alone on the same brief; the PersCase draft stays as it is."
                      : null}
                  </p>
                ) : null}
                <DraftView
                  step={left.draft}
                  specs={highlight && leftDraft ? highlightSpecs(leftDraft.result) : []}
                  stages={LEFT_DRAFT_STAGES}
                  // The run presses Generate itself, so the hint is not shown then.
                  idleText={scriptRunning ? "" : "Press Generate to write a draft in both columns."}
                />
                <VariantView
                  step={left.variant}
                  specs={
                    highlight && left.variant.status === "done"
                      ? highlightSpecs({
                          signals: { concepts: left.variant.data.result.coverage.concepts, grounding: null },
                        })
                      : []
                  }
                  stages={LEFT_VARIANT_STAGES}
                  teamName={team.displayName}
                  side="left"
                  base={leftDraft ? draftBase(leftDraft) : undefined}
                  discipline={(leftDraft ?? rightDraft)?.brief.discipline ?? brief.discipline}
                />
                <span data-box-marker="left-instructor" hidden />
              </Column>
              <Column
                title="PersCase"
                blurb={PERSCASE_BLURB}
                reserveControlRow
                scrollKey={resultKey(right.draft, right.variant)}
                notice={notices.right.instructor}
              >
                {/* A failed draft is said first, above the notes (folded),
                    so that it is the first thing in the column. */}
                {right.draft.status === "error" ? (
                  <div className="mb-4">
                    <ErrorLine message={right.draft.message} />
                  </div>
                ) : null}
                {retrieving ? (
                  <div id="right-trace" className="mb-4 scroll-mt-4">
                    <Progress label="Retrieving notes" stages={RETRIEVAL_STAGES} />
                  </div>
                ) : retrievalError ? (
                  <div id="right-trace" className="mb-4 scroll-mt-4">
                    <ErrorLine message={retrievalError} />
                  </div>
                ) : retrieval ? (
                  <RetrievalStep
                    key={retrieval.runId}
                    id="right-trace"
                    trace={retrieval.trace}
                    provenance={retrieval.provenance}
                    staged={retrieval.staged}
                    // Once a draft is being written from these notes, or is on
                    // the page, the notes fold to one line so that the draft is
                    // the first text in the column. A draft from before this
                    // retrieval (a second run's step 1) leaves them open.
                    // A failed draft keeps them folded too; the error is above.
                    fold={
                      right.draft.status === "loading" ||
                      right.draft.status === "error" ||
                      (right.draft.status === "done" && right.draft.data.runId > retrieval.runId)
                    }
                    onRevealed={() => {
                      const resolve = revealWaiter.current;
                      revealWaiter.current = null;
                      resolve?.();
                    }}
                    footer={
                      <>
                        {retrievalNote ? (
                          <p className="text-[13px] text-muted-foreground">{retrievalNote}</p>
                        ) : null}
                        <DifferencesPanel
                          cards={retrievalCards}
                          step="retrieval"
                          title="What differs at retrieval"
                          compact
                        />
                      </>
                    }
                  />
                ) : null}
                <DraftView
                  step={right.draft}
                  specs={highlight && rightDraft ? highlightSpecs(rightDraft.result) : []}
                  stages={RIGHT_DRAFT_STAGES}
                  errorShownAbove
                  idleText={
                    scriptRunning
                      ? ""
                      : retrieval
                        ? "Press Generate to write a draft in both columns from these notes."
                        : "Press Retrieve notes to see the notes PersCase is given, or Generate to write a draft in both columns."
                  }
                />
                {regenerating ? (
                  <div className="mt-4">
                    <Progress
                      label={`Regenerating the ${SECTION_NAMES[regenerating]}`}
                      stages={[
                        `rewriting the ${SECTION_NAMES[regenerating]} with the missing concepts named`,
                        "checking must-cover concepts",
                      ]}
                    />
                  </div>
                ) : sectionForFlagged ? (
                  // The instructor's remedy, offered whenever the check flags
                  // a concept in the draft on the page.
                  <div className="mt-4 space-y-2 rounded-md bg-muted/60 p-3">
                    <p className="text-[13px] leading-snug text-muted-foreground">
                      The check shows {listInWords(flagged)} missing. The instructor&apos;s remedy is to
                      regenerate one section with the missing concepts named in the request.
                    </p>
                    <GuardedButton
                      variant="outline"
                      size="sm"
                      data-control="regenerate"
                      onClick={() => void regenerate()}
                      off={controlsOff}
                    >
                      Regenerate {SECTION_NAMES[sectionForFlagged]}
                    </GuardedButton>
                  </div>
                ) : null}
                {regenerateError ? (
                  <div className="mt-3">
                    <ErrorLine message={regenerateError} />
                  </div>
                ) : null}
                <VariantView
                  step={right.variant}
                  specs={
                    highlight && right.variant.status === "done"
                      ? highlightSpecs({
                          signals: { concepts: right.variant.data.result.coverage.concepts, grounding: null },
                        })
                      : []
                  }
                  stages={RIGHT_VARIANT_STAGES}
                  teamName={team.displayName}
                  side="right"
                  base={rightDraft ? draftBase(rightDraft) : undefined}
                  discipline={(rightDraft ?? leftDraft)?.brief.discipline ?? brief.discipline}
                />
                <span data-box-marker="right-instructor" hidden />
              </Column>
            </div>
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="demo-panel-student"
        aria-labelledby="demo-tab-student"
        hidden={scene !== "student"}
        className="space-y-6"
      >
        <h2 className="sr-only">Student: answer the case</h2>
        <section
          aria-labelledby="demo-student-case-title"
          className="space-y-5 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-6"
        >
          <h3 id="demo-student-case-title" className="text-lg font-semibold">
            {CASE_TITLES[source]}
          </h3>
          <Field label="Case" htmlFor="demo-source">
            <select
              id="demo-source"
              value={source}
              disabled={controlsOff}
              onChange={(e) => {
                setSource(e.target.value === "generated" ? "generated" : "seed");
                resetHints();
              }}
              className={cn(SELECT_CLASS, "sm:w-auto")}
            >
              <option value="seed">{CASE_TITLES.seed}</option>
              <option value="generated" disabled={!rightContent}>
                {CASE_TITLES.generated}
              </option>
            </select>
          </Field>

          {source === "seed" || rightContent ? (
            <div className="space-y-3 rounded-md bg-muted/60 px-4 py-2 text-sm">
              {/* The questions are collapsed, so that on a phone the presets
                  and the message box are not a screen and a half down; the
                  question a message names is shown above the box instead. */}
              <details>
                <summary className="flex min-h-[44px] cursor-pointer items-center rounded-md font-semibold">
                  Discussion questions
                  {currentQuestions ? ` (${currentQuestions.length})` : ""}
                </summary>
                {currentQuestions ? (
                  <ol className="mt-1 list-decimal space-y-1 pl-5 leading-relaxed">
                    {currentQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ol>
                ) : source === "seed" && seedCase.status === "error" ? (
                  <p className="mt-1 text-muted-foreground">
                    The questions could not be loaded: {seedCase.message}
                  </p>
                ) : (
                  <p className="mt-1 text-muted-foreground">Loading the questions.</p>
                )}
              </details>
              {source === "seed" ? (
                <div className="border-t pb-2 pt-3">
                  <p className="font-semibold">
                    Answer-phase task:{" "}
                    {phaseTitleText(
                      seedCase.status === "done" && seedCase.data.phasePrompt
                        ? seedCase.data.phasePrompt.title
                        : FINANCE_LAST_PHASE.studentTitle,
                    )}
                  </p>
                  <p className="mt-1 leading-relaxed">
                    {seedCase.status === "done" && seedCase.data.phasePrompt
                      ? seedCase.data.phasePrompt.prompt
                      : FINANCE_LAST_PHASE.studentPrompt}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t pt-5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={PRESET_CHIP}
              onClick={() => setMessage(STUDENT_ASK_FOR_ANSWER)}
              disabled={scriptRunning}
            >
              {STUDENT_ASK_FOR_ANSWER}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={PRESET_CHIP}
              onClick={() => setMessage(STUDENT_DRAFT_ANSWER)}
              disabled={scriptRunning}
            >
              An answer ({wordCount(STUDENT_DRAFT_ANSWER)} words)
            </Button>
          </div>

          {namedQuestion ? (
            <div className="rounded-md border-l-2 border-primary bg-muted/60 px-4 py-3 text-sm">
              <p className="font-semibold">Question {namedQuestion.n}</p>
              <p className="mt-1 leading-relaxed">{namedQuestion.text}</p>
            </div>
          ) : null}

          <Field label="Your message" htmlFor="demo-message">
            <Textarea
              id="demo-message"
              value={message}
              maxLength={MESSAGE_MAX}
              rows={5}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask for help, or paste an answer"
            />
          </Field>
          <p className="text-[13px] text-muted-foreground">
            Do not include names or details of real people. A message that asks for the answer to
            a question, or one under 40 words, is sent as a request for a hint; a longer answer is
            sent for feedback.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <GuardedButton
              variant="outline"
              data-control="send"
              onClick={() => void send(message)}
              loading={answering}
              off={controlsOff || message.trim() === "" || (source === "generated" && !rightContent)}
            >
              Send
            </GuardedButton>
            {modeNow ? (
              <span className="text-[13px] text-muted-foreground">
                {modeNow === "hint" ? "Will be sent as a request for a hint." : "Will be sent for feedback."}
              </span>
            ) : null}
          </div>
          <RefusalLine refusal={refusal} place="student" />
        </section>

        {paused ? (
          pausedBlock
        ) : (
          <>
            <DifferencesPanel cards={studentCards} step="student" title="What differs in the replies" />
            <div id="demo-columns-student" className="grid gap-6 md:grid-cols-2">
              <Column
                title="Standard LLM"
                blurb={STUDENT_LEFT_BLURB}
                scrollKey={resultKey(left.student)}
                notice={notices.left.student}
              >
                <PlainStudentView step={left.student} idleText="Send a message to see both replies." />
                <span data-box-marker="left-student" hidden />
              </Column>
              <Column
                title="PersCase"
                blurb={STUDENT_RIGHT_BLURB}
                scrollKey={resultKey(right.student)}
                notice={notices.right.student}
              >
                <PersCaseStudentView
                  step={right.student}
                  hints={hints}
                  idleText="Send a message to see both replies."
                  stages={
                    (studentModePending ?? studentModeSent) === "hint"
                      ? RIGHT_HINT_STAGES
                      : RIGHT_FEEDBACK_STAGES
                  }
                  onAskAgain={showAskForHint ? askForHint : undefined}
                  askAgainOff={controlsOff}
                />
                <span data-box-marker="right-student" hidden />
              </Column>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// A step refused for lack of allowance, beside the control that started it.
function RefusalLine({
  refusal,
  place,
}: {
  refusal: { place: RefusalPlace; message: string } | null;
  place: RefusalPlace;
}) {
  if (!refusal || refusal.place !== place) return null;
  return (
    <p role="alert" className="text-[13px] text-flag">
      {refusal.message}.
    </p>
  );
}

// The same field style as components/ui/input.tsx.
// The student scene's two example messages, as outline chips.
const PRESET_CHIP = "h-auto min-h-11 whitespace-normal rounded-full px-4 py-2 text-left text-[13px] font-medium";

const SELECT_CLASS = cn(
  "h-9 w-full rounded-md border border-input/70 bg-card px-2.5 text-sm text-foreground shadow-xs",
  "transition-[border-color,box-shadow] duration-150 hover:border-input",
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-sm font-medium">
          {label}
        </label>
      ) : (
        <p className="text-sm font-medium">{label}</p>
      )}
      {children}
    </div>
  );
}
