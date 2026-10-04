"use client";

import type { ReactNode } from "react";
import type { ArmSignals, SectionPresence } from "@/lib/generation/compare";
import type { DraftData, Step, VariantData } from "./column";

const SECTION_LABELS: { key: keyof SectionPresence; label: string }[] = [
  { key: "scenario", label: "scenario" },
  { key: "discussionQuestions", label: "discussion questions" },
  { key: "modelAnswers", label: "model answers" },
  { key: "rubric", label: "rubric" },
];

interface Cell {
  value: string;
  // Smaller text on the same line as the value.
  qualifier?: string;
  note?: string;
  // A sentence rather than a figure: set in body text, not as a number.
  plain?: boolean;
}

function conceptsCell(s: ArmSignals, atGeneration?: ArmSignals): Cell {
  const total = s.conceptsCovered.length + s.conceptsMissing.length;
  // After a regeneration the cell reads, for example, "4/4 after
  // regeneration (3/4 at generation)".
  const qualifier = atGeneration
    ? `after regeneration (${atGeneration.conceptsCovered.length}/${
        atGeneration.conceptsCovered.length + atGeneration.conceptsMissing.length
      } at generation)`
    : undefined;
  return {
    value: `${s.conceptsCovered.length}/${total}`,
    qualifier,
    note: s.conceptsMissing.length > 0 ? `missing: ${s.conceptsMissing.join(", ")}` : undefined,
  };
}

// The cell of a column whose draft failed, in place of a dash.
const FAILED: Record<"left" | "right", Cell> = {
  left: { value: "not available: the standard LLM draft failed", plain: true },
  right: { value: "not available: the PersCase draft failed", plain: true },
};

function groundingCell(d: DraftData, isPersCase: boolean, persCaseFailed = false): Cell {
  const g = d.result.signals.grounding;
  if (!g) {
    return {
      value: "n/a",
      note: isPersCase
        ? "no notes were retrieved for this brief"
        : d.aligned
          ? "no notes were retrieved for this brief"
          : persCaseFailed
            ? "not read: the PersCase draft failed"
            : "not yet read against the notes PersCase retrieved",
    };
  }
  const notCountable = g.total - g.countable;
  return {
    value: `${g.used}/${g.countable}`,
    note:
      notCountable > 0
        ? `countable notes, of ${g.total} retrieved; ${notCountable} not countable`
        : `countable notes, of ${g.total} retrieved`,
  };
}

function sectionsCell(d: DraftData): Cell {
  const missing = SECTION_LABELS.filter(({ key }) => !d.result.signals.sections[key]);
  const notes = [
    d.result.kind === "text" ? "from headings" : null,
    missing.length > 0 ? `missing: ${missing.map((m) => m.label).join(", ")}` : null,
  ].filter(Boolean);
  return {
    value: `${SECTION_LABELS.length - missing.length}/${SECTION_LABELS.length}`,
    note: notes.length > 0 ? notes.join("; ") : undefined,
  };
}

function variantConceptsCell(v: VariantData): Cell {
  const c = v.result.coverage;
  const total = c.concepts.length || c.covered.length + c.missing.length;
  return {
    value: `${c.covered.length}/${total}`,
    note: c.missing.length > 0 ? `missing: ${c.missing.join(", ")}` : undefined,
  };
}

function variantDiffCell(v: VariantData): Cell {
  const d = v.result.differingSentences;
  return { value: `${d.differing}/${d.total}` };
}

// The readings of the two drafts on one line each, the same readings and the
// same formatting as the three-way view on the admin side.
export function ReadingsStrip({
  left,
  right,
  leftVariant,
  rightVariant,
}: {
  left: Step<DraftData>;
  right: Step<DraftData>;
  leftVariant: Step<VariantData>;
  rightVariant: Step<VariantData>;
}) {
  const l = left.status === "done" ? left.data : null;
  const r = right.status === "done" ? right.data : null;
  if (!l && !r) return null;
  // A column whose draft failed reads "not available" in every row, with the
  // reason, rather than a dash that looks like a reading still to come.
  const lf = left.status === "error" ? FAILED.left : null;
  const rf = right.status === "error" ? FAILED.right : null;
  const cell = (d: DraftData | null, failed: Cell | null, read: (d: DraftData) => Cell) =>
    d ? read(d) : failed;
  const lv = leftVariant.status === "done" ? leftVariant.data : null;
  const rv = rightVariant.status === "done" ? rightVariant.data : null;

  const row = (label: string, a: Cell | null, b: Cell | null, caption?: string) => (
    <Row label={label} caption={caption}>
      <ValueCell cell={a} />
      <ValueCell cell={b} />
    </Row>
  );

  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5"
      aria-labelledby="demo-readings-caption"
    >
      <p id="demo-readings-caption" className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Readings of each draft. They come from word matching, not from reading for meaning, and
        neither is a measure of quality. &ldquo;Notes reflected&rdquo; reads both drafts
        against the notes PersCase retrieved, which the standard column never saw.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[33%]" />
            <col className="w-[33%]" />
          </colgroup>
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-[0.06em]">
              <th scope="col" className="py-2 pr-4 font-semibold text-muted-foreground">
                Reading
              </th>
              <th scope="col" className="px-4 py-2 font-semibold">
                Standard LLM
              </th>
              <th scope="col" className="px-4 py-2 font-semibold">
                PersCase
              </th>
            </tr>
          </thead>
          <tbody>
            {/* The two readings in which the columns usually differ come first. */}
            {row("Sections present", cell(l, lf, sectionsCell), cell(r, rf, sectionsCell))}
            {row(
              "Notes reflected",
              cell(l, lf, (d) => groundingCell(d, false, rf !== null)),
              cell(r, rf, (d) => groundingCell(d, true)),
            )}
            {row(
              "Must-cover concepts present",
              cell(l, lf, (d) => conceptsCell(d.result.signals)),
              cell(r, rf, (d) => conceptsCell(d.result.signals, d.beforeRegenerate?.signals)),
            )}
            {row(
              "Word count",
              cell(l, lf, (d) => ({ value: d.result.signals.wordCount.toLocaleString() })),
              cell(r, rf, (d) => ({ value: d.result.signals.wordCount.toLocaleString() })),
            )}
            {lv || rv ? (
              <>
                {row(
                  "Must-cover concepts present in the variant",
                  lv ? variantConceptsCell(lv) : null,
                  rv ? variantConceptsCell(rv) : null,
                )}
                {row(
                  "Sentences that differ from the draft",
                  lv ? variantDiffCell(lv) : null,
                  rv ? variantDiffCell(rv) : null,
                )}
              </>
            ) : null}
          </tbody>
        </table>
      </div>
      <details className="border-t pt-3 text-sm">
        <summary className="w-fit cursor-pointer rounded-md py-1.5 font-medium text-muted-foreground hover:text-foreground">
          How these readings are computed
        </summary>
        <div className="mt-2 max-w-prose space-y-2 leading-relaxed text-muted-foreground">
          <p>
            A must-cover concept counts as present when its words appear inside one sentence, in
            order or close together, after spelling variants, plurals and simple stems are
            normalised. The scenario, the discussion questions and the model answers are read; the
            rubric is not.
          </p>
          <p>
            Both drafts are read against the notes the PersCase column retrieved. A note counts as
            reflected when one of its distinctive tags, one that the brief did not already supply,
            appears in the draft. A note with no such tag is not countable.
          </p>
          <p>
            The plain prompt returns free text, so its sections are detected from headings. A
            scenario sentence of the variant counts as differing when the draft&apos;s scenario does
            not contain it. The plain variant is free text as well, so there the whole variant is
            compared with the whole draft.
          </p>
        </div>
      </details>
    </section>
  );
}

function Row({ label, caption, children }: { label: string; caption?: string; children: ReactNode }) {
  return (
    <tr className="border-b align-top last:border-b-0">
      <th scope="row" className="py-2 pr-4 text-left font-normal">
        {label}
        {caption ? <span className="mt-0.5 block text-[13px] text-muted-foreground">{caption}</span> : null}
      </th>
      {children}
    </tr>
  );
}

function ValueCell({ cell }: { cell: Cell | null }) {
  if (!cell) {
    return (
      <td className="px-4 py-2 text-muted-foreground">
        <span aria-label="no result">–</span>
      </td>
    );
  }
  if (cell.plain) {
    return <td className="px-4 py-2 text-[13px] text-muted-foreground">{cell.value}</td>;
  }
  return (
    <td className="px-4 py-2">
      <span className="whitespace-nowrap text-lg font-semibold tabular-nums">{cell.value}</span>
      {cell.qualifier ? <span className="text-[13px] text-muted-foreground"> {cell.qualifier}</span> : null}
      {cell.note ? <span className="block text-[13px] text-muted-foreground">{cell.note}</span> : null}
    </td>
  );
}
