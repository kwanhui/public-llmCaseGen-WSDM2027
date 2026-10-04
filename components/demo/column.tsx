"use client";

import {
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  criteriaRated,
  feedbackChecks,
  type SessionFeedback,
} from "@/components/case-viewer/session-work";
import { HINT_LADDER_NOTE, hintHeading } from "@/lib/generation/hint-levels";
import type {
  DemoGenerateResponse,
  DemoPersonaliseResponse,
  DemoStudentResponse,
  RetrievalTrace as DemoRetrievalTrace,
} from "@/lib/demo/contracts";
import {
  buildMatcher,
  demoteHeadings,
  markChildren,
  markString,
  MarkedMarkdown,
  MARKDOWN_CLASSES,
  REMARK_PLUGINS,
  type HighlightSpec,
} from "@/components/compare/marks";
import { caseTextOf, modelAnswersCaveat } from "@/lib/demo/differences";
import { collapseFields, collapseText } from "@/lib/text/collapse";
import { compareFigures, extractFigures, figureKey } from "@/lib/text/figures";
import { changedSentenceKeys, renderedSentenceSpans, sentenceKey } from "@/lib/text/sentence-marks";
import type { CaseSection, CaseTextFields } from "@/lib/generation/schema";
import type { ArmSignals } from "@/lib/generation/compare";
import { SECTION_NAMES } from "@/lib/demo/regenerate";
import type { CaseInput } from "@/lib/disciplines/types";
import { cn } from "@/lib/utils";
import { GuardedButton } from "./guarded-button";
import { Progress } from "./progress";
import { Typewriter } from "./typewriter";
import type { DemoTeam } from "./presets";

// Response shapes of the demo routes, from the routes' own contract file.

export type BaselineArm = "plain" | "structured";
export type RetrievalTrace = DemoRetrievalTrace;
export type GenerateResult = Exclude<DemoGenerateResponse, { arm: "signals" | "retrieve" | "budget" | "regenerate" }>;
export type PersonaliseResult = DemoPersonaliseResponse;
export type StudentResult = DemoStudentResponse;

// What a column holds for one step. A new run replaces the object; nothing
// rendered is changed in place.
export type Step<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; data: T };

export interface DraftData {
  result: GenerateResult;
  // The brief this draft was generated from, which the form may since have
  // changed.
  brief: CaseInput;
  // True once the baseline's readings were recomputed against the notes the
  // PersCase column retrieved.
  aligned: boolean;
  // Keys the typewriter, so replacing the readings does not restart the reveal.
  runId: number;
  // Set once a section of the PersCase draft was regenerated for a flagged
  // concept: `result` then holds the regenerated draft and its readings, and
  // this the readings and the time of the draft as generated.
  beforeRegenerate?: { signals: ArmSignals; elapsedMs: number };
  // The last regeneration; `count` is how many there have been on this draft.
  regeneration?: { section: CaseSection; modelId: string; elapsedMs: number; count: number };
}

export interface VariantData {
  result: PersonaliseResult;
  team: DemoTeam;
  runId: number;
}

export interface StudentData {
  result: StudentResult;
  runId: number;
}

// Layout

export function Column({
  title,
  blurb,
  control,
  reserveControlRow = false,
  scrollKey,
  notice,
  children,
}: {
  title: string;
  blurb: string;
  // A request of this column's latest step that was refused (the allowance ran
  // out mid-step). Shown at the top of the box, above the results the column
  // kept from before the step.
  notice?: string | null;
  // Sits on its own row under the title. With reserveControlRow, the row is
  // kept empty in a column without a control, so that the two boxes of a scene
  // start at the same height.
  control?: ReactNode;
  reserveControlRow?: boolean;
  // Changes when a new result arrives, which scrolls the box back to the top.
  scrollKey?: string;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  // True while a "Show the whole text" button is in the box, so that the hint
  // under the box names the button only when there is one to press.
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    if (scrollKey !== undefined) boxRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  // The typewriter grows the content without rendering this component again,
  // so the content is observed as well as the box.
  useEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const measure = () => {
      setOverflows(box.scrollHeight > box.clientHeight + 1);
      setCanExpand(inner.querySelector('[data-expand-text][aria-expanded="false"]') !== null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    // A button that appears or opens without changing the box's size.
    const mutations = new MutationObserver(measure);
    mutations.observe(inner, { subtree: true, childList: true, attributeFilter: ["aria-expanded"] });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <section className="flex min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-xs">
      <header className="border-b px-4 py-3">
        {/* The title and the control share a row; with reserveControlRow the
            row keeps the control's height in a column without one, so that
            the two cards of a scene start their bodies at the same height. */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
            control || reserveControlRow ? "md:min-h-8" : null,
          )}
        >
          <h3 className="text-lg font-semibold">{title}</h3>
          {control ? <div className="flex h-8 items-center">{control}</div> : null}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground md:min-h-[3.1em]">{blurb}</p>
      </header>
      {/* From md up the box scrolls on its own, and while its content
          overflows it takes focus and a name for keyboard scrolling. Below md
          it grows with its content: a nested scroll box inside a scrolling
          phone page is hard to use, and the collapsed text with "Show the
          whole text" keeps it short. */}
      <div
        ref={boxRef}
        tabIndex={overflows ? 0 : undefined}
        role={overflows ? "region" : undefined}
        aria-label={overflows ? `${title} output, scrollable` : undefined}
        className="relative rounded-b-lg p-4 text-[15px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:max-h-[36rem] md:overflow-auto"
      >
        <div ref={innerRef} className="space-y-5">
          {notice ? <ErrorLine message={notice} /> : null}
          {children}
        </div>
      </div>
      {overflows ? (
        <p className="border-t px-4 py-2 text-[13px] text-muted-foreground">
          {canExpand
            ? "Scroll the box, or press Show the whole text, for the rest."
            : "Scroll the box for the rest."}
        </p>
      ) : null}
    </section>
  );
}

export function ModelFooter({ modelId, elapsedMs }: { modelId?: string; elapsedMs?: number }) {
  if (!modelId && elapsedMs === undefined) return null;
  const time = elapsedMs !== undefined ? `${(elapsedMs / 1000).toFixed(1)} s` : null;
  // The same text as before, "model · 1.2 s"; only the model id is monospace.
  return (
    <p className="mt-4 border-t pt-2 text-[13px] text-muted-foreground">
      {modelId ? <span className="font-mono text-xs">{modelId}</span> : null}
      {modelId && time ? " · " : null}
      {time ? <span className="tabular-nums">{time}</span> : null}
    </p>
  );
}

function Waiting({ text }: { text: string }) {
  return <p className="text-[15px] text-muted-foreground">{text}</p>;
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md bg-flag/[0.08] px-3 py-2 text-sm text-flag ring-1 ring-inset ring-flag/20"
    >
      {message}
    </p>
  );
}

// Collapsing long text

// Drafts, variants and replies show about twelve lines first; the rest opens
// in place. The typewriter reveals the visible part, and continues into the
// rest when the reader opens it.
function ExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      data-expand-text
      className="mt-3 rounded-sm text-sm font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
    >
      {expanded ? "Show less" : "Show the whole text"}
    </button>
  );
}

// Keyed by the caller on the result's runId, so a new result starts collapsed.
// The typewriter reveals the first view only; once the reader opens the whole
// text it is shown at once, rendered, with no second reveal.
function CollapsibleText({ text, render }: { text: string; render: (t: string) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [instant, setInstant] = useState(false);
  const collapsed = useMemo(() => collapseText(text), [text]);
  const shown = expanded || !collapsed.truncated ? text : collapsed.head;
  return (
    <div>
      {instant ? render(shown) : <Typewriter text={shown} renderDone={render} />}
      {collapsed.truncated ? (
        <ExpandButton
          expanded={expanded}
          onClick={() => {
            setInstant(true);
            setExpanded((e) => !e);
          }}
        />
      ) : null}
    </div>
  );
}

function CollapsibleCase({
  content,
  specs,
  marks,
}: {
  content: CaseTextFields;
  specs: HighlightSpec[];
  marks?: FieldMarks;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = useMemo(() => collapseFields(content), [content]);
  const shown = expanded || !collapsed.truncated ? content : collapsed.content;
  return (
    <div>
      <CaseBlocks content={shown} full={content} specs={specs} marks={marks} />
      {collapsed.truncated ? (
        <ExpandButton expanded={expanded} onClick={() => setExpanded((e) => !e)} />
      ) : null}
    </div>
  );
}

// Marking what a variant changed

// Amber tint for a sentence that is not in the column's own draft. The same
// tint in both columns; it marks a change, not a judgement of it.
const CHANGED_MARK = "bg-[hsl(32_95%_44%/0.18)] text-inherit";

// Keys of the changed sentences per field (lib/text/sentence-marks.ts), and
// the figure keys of the variant that the draft does not have.
export interface FieldMarks {
  scenario?: Set<string>;
  discussionQuestions?: Set<string>;
  modelAnswers?: Set<string>;
  rubric?: Set<string>;
  figures: Set<string>;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

// Markdown with the changed sentences marked. The text of each paragraph,
// list item and table cell is read as a whole, split into sentences, and every
// piece of text inside a changed sentence is wrapped, including the pieces
// inside bold or italic runs. Concept marks still apply inside and outside the
// changed sentences; a changed figure inside a changed sentence is set bold.
function DiffMarkdown({
  children,
  specs,
  changed,
  figures,
  className,
}: {
  children: string;
  specs: HighlightSpec[];
  changed?: Set<string>;
  figures?: Set<string>;
  className?: string;
}) {
  if (!changed || changed.size === 0) {
    return (
      <MarkedMarkdown specs={specs} className={className}>
        {children}
      </MarkedMarkdown>
    );
  }
  const re = buildMatcher(specs);
  const figureSet = figures ?? new Set<string>();
  const blockTypes = new Set<unknown>();

  const concepts = (s: string): ReactNode => (re ? markString(s, specs, re) : s);

  const decorate = (s: string, flagged: boolean): ReactNode => {
    if (!flagged || figureSet.size === 0) return concepts(s);
    const out: ReactNode[] = [];
    let last = 0;
    let k = 0;
    for (const f of extractFigures(s)) {
      if (!figureSet.has(figureKey(f))) continue;
      if (f.index > last) out.push(<Fragment key={k++}>{concepts(s.slice(last, f.index))}</Fragment>);
      out.push(
        <span key={k++} className="font-semibold">
          {s.slice(f.index, f.end)}
        </span>,
      );
      last = f.end;
    }
    if (last < s.length) out.push(<Fragment key={k++}>{concepts(s.slice(last))}</Fragment>);
    return out;
  };

  const markBlock = (inner: ReactNode): ReactNode => {
    const plain = textOf(inner);
    const ranges = renderedSentenceSpans(plain).filter((sp) =>
      changed.has(sentenceKey(plain.slice(sp.start, sp.end))),
    );
    if (ranges.length === 0) return re ? markChildren(inner, specs, re) : inner;
    let offset = 0;
    let key = 0;
    const markText = (text: string): ReactNode => {
      const start = offset;
      offset += text.length;
      const out: ReactNode[] = [];
      let pos = 0;
      for (const r of ranges) {
        const a = Math.max(r.start - start, pos);
        const b = Math.min(r.end - start, text.length);
        if (b <= a) continue;
        if (a > pos) out.push(<Fragment key={key++}>{decorate(text.slice(pos, a), false)}</Fragment>);
        out.push(
          <mark key={key++} className={CHANGED_MARK} title="Not in this column's draft">
            {decorate(text.slice(a, b), true)}
          </mark>,
        );
        pos = b;
      }
      if (pos < text.length) out.push(<Fragment key={key++}>{decorate(text.slice(pos), false)}</Fragment>);
      return <Fragment key={key++}>{out}</Fragment>;
    };
    const walk = (node: ReactNode): ReactNode => {
      if (typeof node === "string") return markText(node);
      if (typeof node === "number") return markText(String(node));
      if (Array.isArray(node)) return node.map(walk);
      if (isValidElement(node)) {
        // A paragraph inside a list item marks itself.
        if (blockTypes.has(node.type)) {
          offset += textOf(node).length;
          return node;
        }
        const el = node as ReactElement<{ children?: ReactNode }>;
        if (el.props.children === undefined) return el;
        return cloneElement(el, undefined, walk(el.props.children));
      }
      return node;
    };
    return walk(inner);
  };

  const wrap = (tag: string, block: boolean) => {
    const Marked = (props: { children?: ReactNode; node?: unknown } & Record<string, unknown>) => {
      const { children: inner, node: _node, ...rest } = props;
      void _node;
      return createElement(tag, rest, block ? markBlock(inner) : re ? markChildren(inner, specs, re) : inner);
    };
    Marked.displayName = `DiffMarked_${tag}`;
    if (block) blockTypes.add(Marked);
    return Marked;
  };
  const components = {
    p: wrap("p", true),
    li: wrap("li", true),
    td: wrap("td", true),
    th: wrap("th", true),
    blockquote: wrap("blockquote", false),
    ...demoteHeadings((inner) => (re ? markChildren(inner, specs, re) : inner)),
  } as unknown as Components;
  return (
    <div className={cn(MARKDOWN_CLASSES, className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Case content

function Block({
  heading,
  body,
  specs,
  changed,
  figures,
}: {
  heading: string;
  body: string;
  specs: HighlightSpec[];
  changed?: Set<string>;
  figures?: Set<string>;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground">{heading}</h4>
      <DiffMarkdown
        className="mt-1.5 text-[15px] [&_p]:whitespace-pre-line"
        specs={specs}
        changed={changed}
        figures={figures}
      >
        {body}
      </DiffMarkdown>
    </div>
  );
}

// Under every draft and variant, in both columns: what the tool does not
// verify, in the terms of the brief's discipline (modelAnswersCaveat in
// lib/demo/differences.ts).
function ModelAnswersCaveat({
  discipline,
  freeText,
  perscase,
}: {
  discipline: CaseInput["discipline"];
  freeText: boolean;
  perscase: boolean;
}) {
  return (
    <p className="mt-4 text-[13px] italic leading-relaxed text-muted-foreground">
      {modelAnswersCaveat(discipline, { freeText, perscase })}
    </p>
  );
}

function numbered(items: string[]): string {
  return items.map((q, i) => `${i + 1}. ${q}`).join("\n\n");
}

// The four blocks of a structured case. A variant written from a free-text
// draft comes back with the text in the scenario field and nothing else, and
// is then shown as text without headings. `full` is the whole case when
// `content` is its collapsed head, so that a head that ends inside the
// scenario still reads as a case with headings.
export function CaseBlocks({
  content,
  specs,
  full,
  marks,
}: {
  content: CaseTextFields;
  specs: HighlightSpec[];
  full?: CaseTextFields;
  marks?: FieldMarks;
}) {
  const whole = full ?? content;
  const onlyText =
    whole.discussionQuestions.length === 0 &&
    whole.modelAnswers.length === 0 &&
    whole.rubric.trim() === "";
  if (onlyText) {
    return (
      <DiffMarkdown
        className="text-[15px]"
        specs={specs}
        changed={marks?.scenario}
        figures={marks?.figures}
      >
        {content.scenario}
      </DiffMarkdown>
    );
  }
  return (
    <div className="space-y-5">
      {content.scenario.trim() ? (
        <Block
          heading="Scenario"
          body={content.scenario}
          specs={specs}
          changed={marks?.scenario}
          figures={marks?.figures}
        />
      ) : null}
      {content.discussionQuestions.length > 0 ? (
        <Block
          heading="Discussion questions"
          body={numbered(content.discussionQuestions)}
          specs={specs}
          changed={marks?.discussionQuestions}
          figures={marks?.figures}
        />
      ) : null}
      {content.modelAnswers.length > 0 ? (
        <Block
          heading="Model answers"
          body={numbered(content.modelAnswers)}
          specs={specs}
          changed={marks?.modelAnswers}
          figures={marks?.figures}
        />
      ) : null}
      {content.rubric.trim() ? (
        <Block
          heading="Rubric"
          body={content.rubric}
          specs={specs}
          changed={marks?.rubric}
          figures={marks?.figures}
        />
      ) : null}
    </div>
  );
}

// What a variant is compared with: the column's own draft, as free text or as
// a case. Pass draftBase(draft) as VariantView's `base`.
export type DraftBase = CaseTextFields | string;

export function draftBase(draft: DraftData | GenerateResult): DraftBase {
  const r = "result" in draft ? draft.result : draft;
  return r.kind === "text" ? r.text : r.content;
}

function changedFigureKeys(before: string, after: string): Set<string> {
  return new Set(compareFigures(before, after).unmatchedAfter.map(figureKey));
}

// Changed sentences field by field for a structured variant against a
// structured draft; a free-text variant, or a draft given as text, is
// compared as one text.
export function variantMarks(result: PersonaliseResult, base: DraftBase): FieldMarks {
  const baseText = caseTextOf(base);
  if (result.kind === "text") {
    return {
      scenario: changedSentenceKeys(baseText, result.text),
      figures: changedFigureKeys(baseText, result.text),
    };
  }
  const c = result.content;
  const figures = changedFigureKeys(baseText, caseTextOf(c));
  if (typeof base === "string") {
    return { scenario: changedSentenceKeys(base, caseTextOf(c)), figures };
  }
  return {
    scenario: changedSentenceKeys(base.scenario, c.scenario),
    discussionQuestions: changedSentenceKeys(numbered(base.discussionQuestions), numbered(c.discussionQuestions)),
    modelAnswers: changedSentenceKeys(numbered(base.modelAnswers), numbered(c.modelAnswers)),
    rubric: changedSentenceKeys(base.rubric, c.rubric),
    figures,
  };
}

// Instructor scene

const NUMBER_WORDS = ["no", "once", "twice", "three times"];

// The heading of a stored PersCase draft, which the route returns when the
// model failed every attempt on the scripted preset's brief.
export function storedDraftHeading(failedAttempts: number | undefined): string {
  const n = failedAttempts ?? 3;
  const times = NUMBER_WORDS[n] ?? `${n} times`;
  return `Stored draft from an earlier run; the model failed ${times} just now`;
}

export function DraftView({
  step,
  specs,
  stages,
  idleText,
  before,
  errorShownAbove = false,
}: {
  step: Step<DraftData>;
  specs: HighlightSpec[];
  stages: string[];
  // An empty text shows nothing (a guided run presses the buttons itself).
  idleText: string;
  before?: ReactNode;
  // The column shows the error at its top, above the retrieved notes.
  errorShownAbove?: boolean;
}) {
  if (step.status === "idle") return idleText ? <Waiting text={idleText} /> : null;
  // `before` is shown above the draft, and also while it is being written.
  // The demo page passes none, since the retrieval step has its own panel
  // above the draft (retrieval-step.tsx).
  if (step.status === "loading") {
    return (
      <div>
        {before}
        <Progress label="Writing the draft" stages={stages} />
      </div>
    );
  }
  if (step.status === "error") {
    if (errorShownAbove) return before ? <div>{before}</div> : null;
    return (
      <div>
        {before}
        <ErrorLine message={step.message} />
      </div>
    );
  }
  const r = step.data.result;
  const stored = r.arm === "perscase" && r.stored === true;
  return (
    <div>
      {before}
      {stored ? (
        <h4 className="mb-3 rounded-md bg-flag/[0.08] px-3 py-2 text-base font-semibold text-flag ring-1 ring-inset ring-flag/20">
          {storedDraftHeading(r.arm === "perscase" ? r.failedAttempts : undefined)}
        </h4>
      ) : (
        <h4 className="mb-3 text-base font-semibold">Draft</h4>
      )}
      {r.kind === "text" ? (
        <CollapsibleText
          key={step.data.runId}
          text={r.text}
          render={(t) => (
            <MarkedMarkdown specs={specs} className="text-[15px]">
              {t}
            </MarkedMarkdown>
          )}
        />
      ) : (
        <CollapsibleCase key={step.data.runId} content={r.content} specs={specs} />
      )}
      <ModelAnswersCaveat
        discipline={step.data.brief.discipline}
        freeText={r.kind === "text"}
        perscase={r.arm === "perscase"}
      />
      {stored ? (
        // No model wrote this draft just now; the time is the attempts'.
        <p className="mt-4 border-t pt-2 text-[13px] text-muted-foreground">
          Stored draft, read against the notes retrieved above ·{" "}
          <span className="tabular-nums">{(r.elapsedMs / 1000).toFixed(1)} s</span> of failed attempts
        </p>
      ) : (
        <ModelFooter modelId={r.modelId} elapsedMs={r.elapsedMs} />
      )}
      {step.data.regeneration ? (
        <p className="text-[13px] text-muted-foreground">
          Regenerated the {SECTION_NAMES[step.data.regeneration.section]} ·{" "}
          <span className="tabular-nums">{(step.data.regeneration.elapsedMs / 1000).toFixed(1)} s</span>
        </p>
      ) : null}
    </div>
  );
}

// `side` sets id="{side}-variant" on the heading, for the guided run to scroll
// to. `base` is the column's own draft (draftBase(draft)); with it, the
// sentences the variant changed are marked.
export function VariantView({
  step,
  specs,
  stages,
  teamName,
  side,
  base,
  discipline,
}: {
  step: Step<VariantData>;
  specs: HighlightSpec[];
  stages: string[];
  teamName: string;
  side?: "left" | "right";
  base?: DraftBase;
  // The discipline of the brief the draft came from, for the caveat.
  discipline: CaseInput["discipline"];
}) {
  if (step.status === "idle") return null;
  return (
    <div className="border-t pt-5">
      <h4 id={side ? `${side}-variant` : undefined} className="scroll-mt-4 text-base font-semibold">
        Variant for {step.status === "done" ? step.data.team.displayName : teamName}
      </h4>
      <div className="mt-3">
        {step.status === "loading" ? (
          <Progress label="Writing the variant" stages={stages} />
        ) : step.status === "error" ? (
          <ErrorLine message={step.message} />
        ) : (
          <VariantBody
            key={step.data.runId}
            data={step.data}
            specs={specs}
            base={base}
            discipline={discipline}
          />
        )}
      </div>
    </div>
  );
}

function VariantBody({
  data,
  specs,
  base,
  discipline,
}: {
  data: VariantData;
  specs: HighlightSpec[];
  base?: DraftBase;
  discipline: CaseInput["discipline"];
}) {
  const r = data.result;
  const { coverage, differingSentences: d } = r;
  const total = coverage.concepts.length || coverage.covered.length + coverage.missing.length;
  const marks = useMemo(() => (base === undefined ? undefined : variantMarks(r, base)), [r, base]);
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">
        Must-cover concepts present in the variant: {coverage.covered.length}/{total}
        {coverage.missing.length > 0 ? ` (missing: ${coverage.missing.join(", ")})` : ""}.{" "}
        {r.kind === "structured" ? "Scenario sentences" : "Sentences"} that differ from the draft:{" "}
        {d.differing}/{d.total}.
      </p>
      {marks ? (
        <p className="mt-1 text-[13px] text-muted-foreground">
          <mark className={cn(CHANGED_MARK, "text-foreground")}>Tinted</mark>: sentences that are not in
          this column&apos;s draft; figures in <span className="font-semibold text-foreground">bold</span>{" "}
          inside them are not in the draft either.
        </p>
      ) : null}
      <div className="mt-3">
        {r.kind === "text" ? (
          <CollapsibleText
            text={r.text}
            render={(t) => (
              <DiffMarkdown
                className="text-[15px]"
                specs={specs}
                changed={marks?.scenario}
                figures={marks?.figures}
              >
                {t}
              </DiffMarkdown>
            )}
          />
        ) : (
          <CollapsibleCase content={r.content} specs={specs} marks={marks} />
        )}
      </div>
      <ModelAnswersCaveat
        discipline={discipline}
        freeText={r.kind === "text"}
        perscase={r.arm === "perscase"}
      />
      <ModelFooter modelId={r.modelId} elapsedMs={r.elapsedMs} />
    </div>
  );
}

// Student scene

const BAND_STYLE: Record<string, string> = {
  "needs work": "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  developing: "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200",
  proficient: "bg-primary/15 text-primary",
  strong: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200",
};

// The reply carries id="left-reply" for the guided run to scroll to.
export function PlainStudentView({
  step,
  idleText,
  anchorId = "left-reply",
}: {
  step: Step<StudentData>;
  idleText: string;
  anchorId?: string;
}) {
  return (
    <div id={anchorId} className="scroll-mt-4">
      <PlainStudentBody step={step} idleText={idleText} />
    </div>
  );
}

function PlainStudentBody({ step, idleText }: { step: Step<StudentData>; idleText: string }) {
  if (step.status === "idle") return <Waiting text={idleText} />;
  if (step.status === "loading") return <Progress label="Writing the reply" stages={["generating"]} />;
  if (step.status === "error") return <ErrorLine message={step.message} />;
  const r = step.data.result;
  if (r.arm !== "plain") return null;
  return (
    <div>
      <CollapsibleText
        key={step.data.runId}
        text={r.text}
        render={(t) => (
          <MarkedMarkdown specs={[]} className="text-[15px]">
            {t}
          </MarkedMarkdown>
        )}
      />
      <p className="mt-3 text-[13px] italic text-muted-foreground">
        AI-generated, not reviewed by your instructor.
      </p>
      <ModelFooter modelId={r.modelId} elapsedMs={r.elapsedMs} />
    </div>
  );
}

// The reply carries id="right-reply" for the guided run to scroll to. With
// onAskAgain, an "Ask for hint n of 3" button follows the latest hint while
// hints remain; it asks the PersCase column only. It stays focusable while a
// request runs (aria-disabled), so that focus is not dropped to the page.
export function PersCaseStudentView({
  step,
  hints,
  idleText,
  stages,
  onAskAgain,
  askAgainOff = false,
  anchorId = "right-reply",
}: {
  step: Step<StudentData>;
  hints: { hint: string; levelName?: string; index: number; total: number }[];
  idleText: string;
  stages: string[];
  onAskAgain?: () => void;
  // The page's controls are off (a step runs, or the allowance is spent).
  askAgainOff?: boolean;
  anchorId?: string;
}) {
  const latest = step.status === "done" ? step.data.result : null;
  const lastHint = hints.length > 0 ? hints[hints.length - 1] : null;
  return (
    <div id={anchorId} className="scroll-mt-4 space-y-4">
      {hints.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[13px] italic text-muted-foreground">
            AI-generated hints, not reviewed by your instructor.
          </p>
          <p className="inline-block rounded-2xl bg-student/10 px-3 py-1 text-[13px] leading-snug text-student">
            {HINT_LADDER_NOTE}
          </p>
          {hints.map((h) => (
            <div key={h.index} className="rounded-md border bg-card p-3 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {hintHeading(h.index, h.total)}
              </p>
              <MarkedMarkdown specs={[]} className="mt-1 text-[15px] [&_p]:my-1">
                {h.hint}
              </MarkedMarkdown>
            </div>
          ))}
          {onAskAgain && lastHint && lastHint.index < lastHint.total ? (
            <GuardedButton
              variant="outline"
              size="sm"
              className="h-11 text-[13px]"
              onClick={onAskAgain}
              off={askAgainOff || step.status === "loading"}
              loading={step.status === "loading"}
            >
              {hintHeading(lastHint.index + 1, lastHint.total, "Ask for hint")}
            </GuardedButton>
          ) : null}
        </div>
      ) : null}
      {step.status === "idle" && hints.length === 0 ? <Waiting text={idleText} /> : null}
      {step.status === "loading" ? <Progress label="Writing the reply" stages={stages} /> : null}
      {step.status === "error" ? <ErrorLine message={step.message} /> : null}
      {latest && latest.arm === "perscase" && latest.mode === "feedback" ? (
        "assessment" in latest ? (
          <Assessment feedback={latest.assessment} />
        ) : (
          <div className="rounded-md bg-muted/60 px-4 py-3 text-sm">
            <p className="font-semibold">No rating for this answer</p>
            <p className="mt-1 text-muted-foreground">{latest.notRated.reason}</p>
          </div>
        )
      ) : null}
      {latest ? <ModelFooter modelId={latest.modelId} elapsedMs={latest.elapsedMs} /> : null}
    </div>
  );
}

// The same reading of an assessment as the student case viewer, without the
// flag control, which has no instructor to reach in the public demo.
function Assessment({ feedback }: { feedback: SessionFeedback }) {
  const { flags, safetyNote } = feedbackChecks(feedback);
  const total = feedback.criteriaTotal ?? feedback.criteria.length;
  const rated = criteriaRated(feedback);
  return (
    <div className="text-[15px]">
      {flags.length > 0 ? (
        <div className="mb-3 rounded-md bg-flag/[0.08] px-3 py-2 text-sm ring-1 ring-inset ring-flag/20">
          <p className="font-semibold">Checks</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-flag">
            {flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold">Formative feedback</span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            BAND_STYLE[feedback.band] ?? "bg-muted text-muted-foreground",
          )}
        >
          {feedback.band.charAt(0).toUpperCase() + feedback.band.slice(1)}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Bands: needs work, developing, proficient, strong; against the rubric&apos;s criteria.
      </p>
      {safetyNote ? <p className="mt-2 text-flag">{safetyNote}</p> : null}
      {feedback.disclosureNote?.trim() ? <p className="mt-2">{feedback.disclosureNote}</p> : null}
      {rated !== total ? (
        <p className="mt-2 text-muted-foreground">
          {total} criteria, {total - rated} not addressed
        </p>
      ) : null}
      <ul className="mt-3 divide-y border-y">
        {feedback.criteria.map((c, i) => (
          <li key={i} className="py-2">
            <span className="font-medium">{c.criterion}:</span>{" "}
            <span className="text-muted-foreground">{c.judgment}</span>
            {c.nextStep ? <div className="mt-0.5">Next: {c.nextStep}</div> : null}
          </li>
        ))}
      </ul>
      {feedback.overall ? (
        <p className="mt-3">
          <span className="font-medium">Overall:</span>{" "}
          <span className="text-muted-foreground">{feedback.overall}</span>
        </p>
      ) : null}
      {feedback.nextStep ? (
        <p className="mt-3 border-l-2 border-primary py-0.5 pl-3">
          <span className="font-semibold">Next step:</span> {feedback.nextStep}
        </p>
      ) : null}
      <p className="mt-3 text-[13px] italic text-muted-foreground">
        AI-generated formative feedback against the rubric. Not a grade.
      </p>
      <p className="text-[13px] italic text-muted-foreground">Not reviewed by your instructor.</p>
    </div>
  );
}
