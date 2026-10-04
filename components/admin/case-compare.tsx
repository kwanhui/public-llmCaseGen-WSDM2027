"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  CONCEPT_MARK,
  MarkedMarkdown,
  NOTE_MARK,
  highlightSpecs,
  type HighlightSpec,
} from "@/components/compare/marks";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { disciplineName } from "@/lib/text/display";
import { CARD, NOTE_FLAG } from "@/components/admin/styles";
import {
  ARM_ADDS,
  ARM_INPUTS,
  type ArmSignals,
  type ComparisonArm,
  type ComparisonView,
  type EditSummary,
  type SectionPresence,
} from "@/lib/generation/compare";

const SECTION_NAMES: Record<string, string> = {
  scenario: "scenario",
  discussionQuestions: "discussion questions",
  modelAnswers: "model answers",
  rubric: "rubric",
  glossary: "glossary",
};

// One sentence for what the instructor did to the draft after generation.
function editsText(edits: EditSummary | null): string {
  if (!edits) return "none";
  const name = (k: string) => SECTION_NAMES[k] ?? k;
  const parts: string[] = [];
  if (edits.saves > 0) {
    parts.push(
      `${edits.saves} in-place save${edits.saves === 1 ? "" : "s"} (${edits.sectionsChanged.map(name).join(", ")})`,
    );
  }
  if (edits.regenerations > 0) {
    parts.push(
      `${edits.regenerations} regeneration${edits.regenerations === 1 ? "" : "s"} (${edits.regeneratedSections.map(name).join(", ")})`,
    );
  }
  if (edits.restoredSections.length > 0) {
    parts.push(`put back: ${edits.restoredSections.map(name).join(", ")}`);
  }
  return parts.join(" · ");
}

const SECTION_LABELS: { key: keyof SectionPresence; label: string }[] = [
  { key: "scenario", label: "scenario" },
  { key: "discussionQuestions", label: "discussion questions" },
  { key: "modelAnswers", label: "model answers" },
  { key: "rubric", label: "rubric" },
];

export function CaseCompare({
  initial,
  fixedBaselinesNote = null,
}: {
  initial: ComparisonView;
  // Set for a seeded example case, whose two baselines are committed and which
  // the API refuses to re-run. The control is then disabled and this sentence,
  // the one the API returns, is printed beside it.
  fixedBaselinesNote?: string | null;
}) {
  const [view, setView] = useState(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(true);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cases/${view.caseId}/compare`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      setView((await res.json()) as ComparisonView);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The baselines could not be generated.");
    } finally {
      setRunning(false);
    }
  }

  const hasGenerated = view.cached;
  const brief = view.brief;
  const discipline = disciplineName(brief.discipline.replace("_", " "));
  const briefSummary = [
    discipline,
    brief.difficulty,
    `${brief.mustCoverConcepts.length} must-cover concept${brief.mustCoverConcepts.length === 1 ? "" : "s"}`,
  ].join(" · ");

  return (
    <div className="space-y-6">
      <details className={cn(CARD, "px-4 py-3 text-sm sm:px-5")}>
        <summary className="cursor-pointer rounded-sm">
          <span className="font-semibold">The brief behind all three outputs</span>
          <span className="ml-2 text-sm text-muted-foreground">{briefSummary}</span>
        </summary>
        <dl className="mt-3 grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2">
          <Field label="Learning objective" value={brief.learningObjective} />
          <Field label="Difficulty" value={brief.difficulty} />
          <Field
            label="Must-cover concepts"
            value={brief.mustCoverConcepts.join(", ") || "(none specified)"}
          />
          <Field
            label="Learner profile"
            value={`${brief.targetLearnerProfile.industry} · ${brief.targetLearnerProfile.role} · ${brief.targetLearnerProfile.priorKnowledge} prior knowledge`}
          />
          <Field label="Discipline" value={discipline} />
        </dl>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-3 sm:px-5">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {hasGenerated ? (
            <>
              The two baselines were generated{" "}
              {view.generatedAt ? `on ${formatDateTime(view.generatedAt)}` : "earlier"}
              {view.modelId ? (
                <>
                  {" "}
                  with <code className="font-mono">{view.modelId}</code>
                </>
              ) : null}
              . The third column is this case&apos;s current draft, including any
              instructor edits, and is not regenerated here.
              {fixedBaselinesNote ? <> {fixedBaselinesNote}</> : null}
            </>
          ) : (
            <>
              The two baselines have not been generated for this case yet. Running them
              makes two model calls on the brief above.
            </>
          )}
        </p>
        {/* Disabled (fixed baselines on an example case), the button is an
            outline, never the one filled control on the page. */}
        <Button
          type="button"
          variant={fixedBaselinesNote !== null ? "outline" : "primary"}
          size="sm"
          onClick={run}
          loading={running}
          disabled={fixedBaselinesNote !== null}
        >
          {running
            ? "Running two model calls…"
            : hasGenerated
              ? "Re-run baselines"
              : "Run baselines"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className={NOTE_FLAG}>
          {error}
        </p>
      ) : null}

      <InputsStrip arms={view.arms} edits={view.edits} />

      <ReadingsTable arms={view.arms} />

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>
          <span className={cn(CONCEPT_MARK[0], "rounded px-1 text-foreground")}>highlighted</span>:
          where a must-cover concept matched, one colour per concept ·{" "}
          <span className={cn(NOTE_MARK, "text-foreground")}>underlined</span>: a retrieved-note
          tag that counted as reflected
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            className="h-4 w-4 accent-[hsl(var(--primary))]"
            type="checkbox"
            checked={highlight}
            onChange={(e) => setHighlight(e.target.checked)}
          />
          Highlight matches in the text
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {view.arms.map((arm) => (
          <ArmColumn key={arm.id} arm={arm} specs={highlight ? highlightSpecs(arm) : []} />
        ))}
      </div>

    </div>
  );
}

// The readings table and the two detail tables under it share these columns, so
// that an output is in the same place in all three. Below the minimum width the
// table scrolls sideways and the first column stays in view.
const TABLE_CLASS = "w-full min-w-[44rem] table-fixed border-collapse";
const FIRST_COLUMN = "sticky left-0 bg-card";
// Column headers: small, uppercase, muted, on the card surface.
const HEAD = "px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const HEAD_ROW = "border-b text-left";
const ROW = "border-b align-top last:border-b-0";
const CELL = "px-4 py-2.5";

function Columns() {
  return (
    <colgroup>
      <col className="w-[22%]" />
      <col className="w-[26%]" />
      <col className="w-[26%]" />
      <col className="w-[26%]" />
    </colgroup>
  );
}

function Tick({ on }: { on: boolean }) {
  return on ? (
    <span aria-label="yes" className="font-semibold text-foreground">
      ✓
    </span>
  ) : (
    <span aria-label="no" className="text-muted-foreground">
      –
    </span>
  );
}

// What each output was given, as one table: the three columns form a
// progression, and the reader should not have to infer it from the blurbs.
function InputsStrip({ arms, edits }: { arms: ComparisonArm[]; edits: EditSummary | null }) {
  if (arms.length === 0) return null;
  const notes = arms.find((a) => a.signals.grounding)?.signals.grounding?.notes ?? [];
  return (
    <section className="space-y-2">
      <p id="inputs-caption" className="text-sm text-muted-foreground">
        What each output was given. Each column adds to the one before it.
      </p>
      <div className={cn(CARD, "overflow-x-auto")}>
        <table aria-describedby="inputs-caption" className={`${TABLE_CLASS} text-sm`}>
          <Columns />
          <thead>
            <tr className={HEAD_ROW}>
              <th scope="col" className={cn(FIRST_COLUMN, HEAD)}>
                Input
              </th>
              {arms.map((arm) => (
                <th key={arm.id} scope="col" className={cn(HEAD, "align-top")}>
                  {arm.label}
                  <span className="mt-0.5 block text-xs font-normal normal-case tracking-normal text-muted-foreground">
                    {ARM_ADDS[arm.id]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <InputRow label="The brief" title="Learning objective, difficulty, must-cover concepts and learner profile">
              {arms.map((arm) => (
                <td key={arm.id} className={CELL}>
                  <Tick on={ARM_INPUTS[arm.id].brief} />
                </td>
              ))}
            </InputRow>
            <InputRow label="Discipline prompt and exemplars">
              {arms.map((arm) => (
                <td key={arm.id} className={CELL}>
                  <Tick on={ARM_INPUTS[arm.id].disciplinePrompt} />
                </td>
              ))}
            </InputRow>
            <InputRow label="Output schema" title="Scenario, discussion questions, model answers, rubric and glossary">
              {arms.map((arm) => (
                <td key={arm.id} className={CELL}>
                  <Tick on={ARM_INPUTS[arm.id].outputSchema} />
                </td>
              ))}
            </InputRow>
            <InputRow label="Retrieved notes" title="The notes retrieved for this case, listed in the readings table below">
              {arms.map((arm) => (
                <td key={arm.id} className={CELL}>
                  <Tick on={ARM_INPUTS[arm.id].retrievedNotes} />
                  {ARM_INPUTS[arm.id].retrievedNotes && notes.length > 0 ? (
                    <span className="ml-2 text-muted-foreground">
                      {notes.length} note{notes.length === 1 ? "" : "s"}, listed under Retrieved notes below
                    </span>
                  ) : null}
                </td>
              ))}
            </InputRow>
            <InputRow label="Instructor edits" title="What the instructor did to the draft after generation, from the event log">
              {arms.map((arm) => (
                <td key={arm.id} className={CELL}>
                  <Tick on={ARM_INPUTS[arm.id].instructorEdits && edits !== null} />
                  {ARM_INPUTS[arm.id].instructorEdits ? (
                    <span className="ml-2 text-muted-foreground">{editsText(edits)}</span>
                  ) : (
                    <span className="ml-2 text-muted-foreground">single sample</span>
                  )}
                </td>
              ))}
            </InputRow>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InputRow({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <tr className={ROW}>
      <th scope="row" title={title} className={cn(FIRST_COLUMN, CELL, "text-left font-medium")}>
        {label}
      </th>
      {children}
    </tr>
  );
}

// One table for the readings, so that the same reading is on one line across
// the three outputs. The per-concept and per-note detail sits under it.
// Instructor edits are stated once, in the inputs strip above.
function ReadingsTable({ arms }: { arms: ComparisonArm[] }) {
  if (arms.length === 0) return null;
  const hasConcepts = arms.some((a) => a.signals.concepts.length > 0);
  const hasNotes = arms.some((a) => a.signals.grounding);
  return (
    <section className="space-y-3">
      <p id="readings-caption" className="text-sm text-muted-foreground">
        Readings of each output (lexical).
      </p>
      <div className={cn(CARD, "overflow-x-auto")}>
        <table aria-describedby="readings-caption" className={`${TABLE_CLASS} text-sm`}>
          <Columns />
          <thead>
            <tr className={HEAD_ROW}>
              <th scope="col" className={cn(FIRST_COLUMN, HEAD)}>
                Reading
              </th>
              {arms.map((arm) => (
                <th key={arm.id} scope="col" className={HEAD}>
                  {arm.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <ReadingRow label="Must-cover concepts present">
              {arms.map((arm) => {
                const s = arm.signals;
                const total = s.conceptsCovered.length + s.conceptsMissing.length;
                return (
                  <ReadingCell
                    key={arm.id}
                    value={`${s.conceptsCovered.length}/${total}`}
                    note={
                      s.conceptsMissing.length > 0
                        ? `missing: ${s.conceptsMissing.join(", ")}`
                        : undefined
                    }
                  />
                );
              })}
            </ReadingRow>
            <ReadingRow label="Notes reflected">
              {arms.map((arm) => {
                const g = arm.signals.grounding;
                const notCountable = g ? g.total - g.countable : 0;
                return (
                  <ReadingCell
                    key={arm.id}
                    value={g ? `${g.used}/${g.countable}` : "n/a"}
                    note={
                      !g
                        ? "no retrieval was recorded for this case"
                        : notCountable > 0
                          ? `countable notes, of ${g.total} retrieved; ${notCountable} not countable`
                          : `countable notes, of ${g.total} retrieved`
                    }
                  />
                );
              })}
            </ReadingRow>
            <ReadingRow label="Sections present">
              {arms.map((arm) => {
                const missing = SECTION_LABELS.filter(({ key }) => !arm.signals.sections[key]);
                const notes = [
                  arm.kind === "text" ? "from headings" : null,
                  missing.length > 0 ? `missing: ${missing.map((m) => m.label).join(", ")}` : null,
                ].filter(Boolean);
                return (
                  <ReadingCell
                    key={arm.id}
                    value={`${SECTION_LABELS.length - missing.length}/${SECTION_LABELS.length}`}
                    note={notes.length > 0 ? notes.join("; ") : undefined}
                  />
                );
              })}
            </ReadingRow>
            <ReadingRow label="Word count">
              {arms.map((arm) => (
                <ReadingCell key={arm.id} value={arm.signals.wordCount.toLocaleString()} />
              ))}
            </ReadingRow>
            <ReadingRow label="Retrieved notes">
              {arms.map((arm) => {
                const notes = arm.signals.grounding?.notes ?? [];
                const given = ARM_INPUTS[arm.id].retrievedNotes && notes.length > 0;
                return (
                  <td key={arm.id} className={CELL}>
                    {given ? (
                      <span>
                        {notes.map((n, i) => (
                          <span key={n.id}>
                            {i > 0 ? <span className="text-muted-foreground"> · </span> : null}
                            <span
                              className={n.countable && !n.reflected ? "text-muted-foreground" : undefined}
                              title={
                                !n.countable
                                  ? "not countable"
                                  : n.reflected
                                    ? "reflected in this output"
                                    : "not reflected in this output"
                              }
                            >
                              {n.reflected ? "✓ " : ""}
                              {n.title}
                              {!n.countable ? <span className="text-muted-foreground"> (n/c)</span> : null}
                            </span>
                          </span>
                        ))}
                        <span className="block text-muted-foreground">
                          ✓ reflected · n/c not countable
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">none</span>
                    )}
                  </td>
                );
              })}
            </ReadingRow>
          </tbody>
        </table>
      </div>

      {hasConcepts ? (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm font-medium text-primary">
            Per concept: the phrase that matched in each output
          </summary>
          <div className={cn(CARD, "mt-2 overflow-x-auto")}>
            <table className={`${TABLE_CLASS} text-sm`}>
              <Columns />
              <thead>
                <tr className={HEAD_ROW}>
                  <th scope="col" className={cn(FIRST_COLUMN, HEAD)}>
                    Concept
                  </th>
                  {arms.map((arm) => (
                    <th key={arm.id} scope="col" className={HEAD}>
                      {arm.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {arms[0].signals.concepts.map((row, i) => (
                  <tr key={row.concept} className={ROW}>
                    <th scope="row" className={cn(FIRST_COLUMN, CELL, "text-left font-medium")}>
                      {row.concept}
                    </th>
                    {arms.map((arm) => (
                      <td key={arm.id} className={CELL}>
                        <ConceptDetail concept={arm.signals.concepts[i]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {hasNotes ? (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm font-medium text-primary">
            Per note: which of its tags matched in each output
          </summary>
          <div className={cn(CARD, "mt-2 overflow-x-auto")}>
            <table className={`${TABLE_CLASS} text-sm`}>
              <Columns />
              <thead>
                <tr className={HEAD_ROW}>
                  <th scope="col" className={cn(FIRST_COLUMN, HEAD)}>
                    Retrieved note
                  </th>
                  {arms.map((arm) => (
                    <th key={arm.id} scope="col" className={HEAD}>
                      {arm.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(arms.find((a) => a.signals.grounding)?.signals.grounding?.notes ?? []).map(
                  (row) => (
                    <tr key={row.id} className={ROW}>
                      <th scope="row" className={cn(FIRST_COLUMN, CELL, "text-left font-medium")}>
                        {row.title}
                        <span className="block font-mono text-xs font-normal text-muted-foreground">
                          {row.id}
                        </span>
                      </th>
                      {arms.map((arm) => {
                        const n = arm.signals.grounding?.notes.find((x) => x.id === row.id);
                        return (
                          <td key={arm.id} className={CELL}>
                            {n ? (
                              <>
                                <span
                                  className={
                                    !n.countable
                                      ? "text-muted-foreground"
                                      : n.reflected
                                        ? undefined
                                        : "text-flag"
                                  }
                                >
                                  {!n.countable
                                    ? "not countable"
                                    : n.reflected
                                      ? "reflected"
                                      : "not reflected"}
                                </span>
                                {n.matchedTags.length > 0 ? (
                                  <span className="text-muted-foreground">
                                    , matched {n.matchedTags.join(", ")}
                                  </span>
                                ) : null}
                                {n.briefMatches.length > 0 ? (
                                  <span className="text-muted-foreground">
                                    , in the brief: {n.briefMatches.join(", ")}
                                  </span>
                                ) : null}
                                {n.genericMatches.length > 0 ? (
                                  <span className="text-muted-foreground">
                                    , generic match not counted: {n.genericMatches.join(", ")}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="text-muted-foreground">n/a</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <details className="text-sm">
        <summary className="w-fit cursor-pointer rounded-sm font-medium text-primary">
          How these readings are computed
        </summary>
        <div className="mt-2 max-w-prose space-y-2 leading-relaxed text-muted-foreground">
          <p>Both readings match words, not meaning, and neither measures quality.</p>
          <p>
            A must-cover concept counts as present when its words appear inside one
            sentence, in order or close together, after spelling variants, plurals and
            simple stems are normalised. A concept written as a tension (X vs Y) is split,
            and each half has to be present. The scenario, the discussion questions and the
            model answers are read; the rubric and the glossary are not.
          </p>
          <p>
            All three outputs are read against the notes this case retrieved. A note
            counts as reflected when one of its distinctive tags appears in the output. A
            tag is distinctive when at most two notes of the corpus carry it and it is a
            term of two or more words, an acronym, or a single word only one note uses. A
            tag that already occurs in the brief is not counted, since every output
            written from the brief carries the brief&apos;s words. A note left with no tag
            that could count is not countable, and the figure is over the countable notes.
          </p>
          <p>
            The plain prompt returns free text, so its sections are detected from
            headings. Its output is shown as the model returned it, with markdown rendered
            and formulas unrendered.
          </p>
        </div>
      </details>
    </section>
  );
}

function ReadingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className={ROW}>
      <th scope="row" className={cn(FIRST_COLUMN, CELL, "text-left font-medium")}>
        {label}
      </th>
      {children}
    </tr>
  );
}

function ReadingCell({ value, note }: { value: string; note?: string }) {
  return (
    <td className={CELL}>
      <span className="whitespace-nowrap text-base font-semibold tabular-nums text-foreground">{value}</span>
      {note ? <span className="block text-sm text-muted-foreground">{note}</span> : null}
    </td>
  );
}

function ConceptDetail({ concept }: { concept: ArmSignals["concepts"][number] | undefined }) {
  if (!concept) return <span className="text-muted-foreground">n/a</span>;
  return (
    <>
      <span className={concept.matched ? undefined : "text-flag"}>
        {concept.matched ? "present" : "missing"}
      </span>
      {concept.parts.length > 0 ? (
        <span className="text-muted-foreground">
          {concept.parts.map((p) => (
            <span key={p.part}>
              {" "}
              · {p.part}: {p.matchedPhrase ? `“${p.matchedPhrase}”` : "missing"}
            </span>
          ))}
        </span>
      ) : concept.matchedPhrase ? (
        <span className="text-muted-foreground">: &ldquo;{concept.matchedPhrase}&rdquo;</span>
      ) : null}
    </>
  );
}

function ArmColumn({ arm, specs }: { arm: ComparisonArm; specs: HighlightSpec[] }) {
  return (
    <section className={cn(CARD, "flex min-w-0 flex-col overflow-hidden")}>
      <header className="border-b px-4 py-3">
        <h3 className="text-base font-semibold">{arm.label}</h3>
        <p className="text-sm text-muted-foreground">{ARM_ADDS[arm.id]}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{arm.blurb}</p>
      </header>
      <div className="relative max-h-[32rem] overflow-auto px-4 py-3 text-sm leading-relaxed">
        {arm.kind === "text" && arm.text ? (
          // The plain arm is markdown, as any chatbot would return. Rendering it
          // keeps the comparison from turning on typesetting.
          <MarkedMarkdown specs={specs}>{arm.text}</MarkedMarkdown>
        ) : arm.content ? (
          <div className="space-y-4">
            <Block heading="Scenario" body={arm.content.scenario} specs={specs} />
            <Block
              heading="Discussion questions"
              body={arm.content.discussionQuestions
                .map((q, i) => `${i + 1}. ${q}`)
                .join("\n\n")}
              specs={specs}
            />
            <Block
              heading="Model answers"
              body={arm.content.modelAnswers.map((a, i) => `${i + 1}. ${a}`).join("\n\n")}
              specs={specs}
            />
            <Block heading="Rubric" body={arm.content.rubric} specs={specs} />
          </div>
        ) : null}
      </div>
      <p className="mt-auto border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        Scroll inside the box for the rest.
      </p>
    </section>
  );
}

function Block({ heading, body, specs }: { heading: string; body: string; specs: HighlightSpec[] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {heading}
      </h4>
      <MarkedMarkdown className="mt-1 [&_p]:whitespace-pre-line" specs={specs}>
        {body}
      </MarkedMarkdown>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
