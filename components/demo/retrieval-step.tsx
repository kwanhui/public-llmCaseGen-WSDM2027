"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { leftOutRuleInWords } from "@/lib/demo/differences";
import type { RetrievalTrace } from "@/lib/demo/contracts";

// The retrieval step of the demo: what the PersCase column retrieved for the
// brief, shown before any draft is written.
//
// In a guided run (`staged`) the notes appear one at a time, STAGE_MS apart,
// followed by the left-out note, the concepts no note mentions and the line
// on where the notes go; `onRevealed` is called once the last line is on the
// page, which is when the guided run lets go of the panel. Otherwise
// everything is shown at once, and Replay plays the same sequence again.
//
// The rows are kept out of any live region, so that a screen reader is not
// read each row as it appears; the count is announced once, at the end.
// `id` ("right-trace") is the element the guided run holds in view; it stays
// on the root whether the panel is open or folded.
//
// With `fold` (a draft is being written or is on the page) the panel folds to
// one line, "5 notes retrieved, one left out. Show", so that the draft is the
// first text in the column. Show opens it again and Hide folds it; each time
// `fold` turns on, the panel folds again.

export const STAGE_MS = 500;

const EMBEDDING_ENTRY = /^embedding:(.+)$/;

// The embedding model, from the provenance's first entry (`embedding:<id>`).
export function embeddingModelOf(provenance: string[]): string | null {
  const m = provenance[0]?.match(EMBEDDING_ENTRY);
  return m ? m[1].trim() : null;
}

function statusMessage(trace: RetrievalTrace): string | null {
  if (trace.status === "retrieval-off") {
    return "Retrieval is switched off on this deployment, so the PersCase draft has the discipline prompt only.";
  }
  if (trace.status === "corpus-not-embedded") {
    return "The notes are not embedded on this deployment, so the PersCase draft has the discipline prompt only.";
  }
  if (trace.notes.length === 0) return "No note passed retrieval for this brief.";
  return null;
}

function pastedLine(k: number): string {
  return k === 1
    ? "This retrieved note is pasted into the PersCase prompt under its own heading; the standard column receives none."
    : `These ${k} retrieved notes are pasted into the PersCase prompt under their own heading; the standard column receives none.`;
}

// The folded panel's line: the count, and the note left out when there is one.
export function foldedLine(trace: RetrievalTrace): string {
  const k = trace.notes.length;
  return `${k} ${k === 1 ? "note" : "notes"} retrieved${trace.leftOut ? ", one left out" : ""}.`;
}

const LINK_BUTTON =
  "-my-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RetrievalStep({
  trace,
  provenance,
  staged = false,
  onRevealed,
  footer,
  id,
  fold = false,
}: {
  trace: RetrievalTrace;
  provenance: string[];
  // Reveal the rows one at a time (the guided run). Give the component a new
  // `key` for each retrieval, so that a new trace starts its own reveal.
  staged?: boolean;
  onRevealed?: () => void;
  // Shown under the trace once everything has appeared (the differences card).
  footer?: ReactNode;
  id?: string;
  // Fold the panel to one line (see above). Not used while the notes are
  // being revealed in step 1, when `fold` is off.
  fold?: boolean;
}) {
  const k = trace.notes.length;
  const empty = statusMessage(trace);
  const model = embeddingModelOf(provenance);

  // The lines after the heading and the query, in the order they appear.
  const tail: { key: string; node: ReactNode }[] = [];
  if (trace.leftOut) {
    tail.push({
      key: "left-out",
      node: (
        <>
          Left out: {trace.leftOut.title} (
          <span className="tabular-nums">{trace.leftOut.score.toFixed(3)}</span>),{" "}
          {leftOutRuleInWords(trace.leftOut.rule, trace.budget)}.
        </>
      ),
    });
  }
  if (trace.status === "ok" && trace.unmentionedConcepts.length > 0) {
    tail.push({
      key: "unmentioned",
      node: <>No retrieved note mentions: {trace.unmentionedConcepts.join(", ")}.</>,
    });
  }
  if (k > 0) tail.push({ key: "pasted", node: pastedLine(k) });

  // Rows first, then the tail lines; `shown` counts how many are on the page.
  const total = empty ? 0 : k + tail.length;
  const [shown, setShown] = useState(staged ? 0 : total);
  const [playing, setPlaying] = useState(staged);
  const revealing = playing && shown < total;

  useEffect(() => {
    if (!revealing) return;
    const t = setTimeout(() => setShown((n) => n + 1), STAGE_MS);
    return () => clearTimeout(t);
  }, [revealing, shown]);

  const done = shown >= total;
  const reportRevealed = useEffectEvent(() => onRevealed?.());
  useEffect(() => {
    if (done) reportRevealed();
  }, [done]);

  // The count, announced once the last line is on the page. It is set a frame
  // after the region has rendered, so that a region mounted with the trace is
  // in place before its text changes.
  const [announcement, setAnnouncement] = useState("");
  const countText = empty ? "" : `${k} ${k === 1 ? "note" : "notes"} retrieved`;
  useEffect(() => {
    if (!done) return;
    const frame = requestAnimationFrame(() => setAnnouncement(countText));
    return () => cancelAnimationFrame(frame);
  }, [done, countText]);

  function replay() {
    setAnnouncement("");
    setShown(0);
    setPlaying(true);
  }

  // Open unless folded; a panel with no notes has nothing to fold. The state
  // follows `fold` each time it changes, and Show or Hide in between.
  const foldable = !empty;
  const [open, setOpen] = useState(!(fold && foldable));
  const [foldSeen, setFoldSeen] = useState(fold);
  if (fold !== foldSeen) {
    setFoldSeen(fold);
    setOpen(!(fold && foldable));
  }

  // Show and Hide replace each other, so focus moves to the one now shown.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusToggle = useRef(false);
  function toggle(next: boolean) {
    focusToggle.current = true;
    setOpen(next);
  }
  useEffect(() => {
    if (!focusToggle.current) return;
    focusToggle.current = false;
    toggleRef.current?.focus();
  }, [open]);

  const rowsShown = Math.min(shown, k);
  const tailShown = Math.max(0, shown - k);

  const status = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (!open) {
    return (
      <div id={id} className="mb-5 scroll-mt-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md bg-muted/60 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground sm:px-4">
          <p>{foldedLine(trace)}</p>
          <button
            type="button"
            ref={toggleRef}
            aria-expanded={false}
            onClick={() => toggle(true)}
            className={LINK_BUTTON}
          >
            Show
          </button>
          {status}
        </div>
      </div>
    );
  }

  return (
    <div id={id} className="mb-5 scroll-mt-4 space-y-3">
      <div className="rounded-md bg-muted/60 p-3 text-[13px] leading-relaxed sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold">Retrieved notes given to the model</h4>
          {!empty && !revealing ? (
            <div className="flex gap-1">
              <button type="button" onClick={replay} className={LINK_BUTTON}>
                Replay
              </button>
              {fold ? (
                <button
                  type="button"
                  ref={toggleRef}
                  aria-expanded
                  onClick={() => toggle(false)}
                  className={LINK_BUTTON}
                >
                  Hide
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {trace.status === "ok" ? (
          <p className="mt-1 text-muted-foreground">
            Query: the brief&apos;s objective, difficulty, concepts and learner context
            {model ? (
              <>
                , embedded with <span className="font-mono">{model}</span>
              </>
            ) : null}
            .
          </p>
        ) : null}
        {empty ? (
          <p className="mt-1 text-muted-foreground">{empty}</p>
        ) : (
          <>
            <p className="mt-1 text-muted-foreground">
              Scores are similarity to the query; a note under{" "}
              <span className="tabular-nums">{trace.weakScore.toFixed(2)}</span> is marked
              weak match.
            </p>
            <ol aria-live="off" className="mt-3 divide-y divide-border border-y border-border">
              {trace.notes.slice(0, rowsShown).map((n, i) => (
                <li key={n.id} className="min-w-0 py-2">
                  <p>
                    <span className="tabular-nums text-muted-foreground">{i + 1}.</span>{" "}
                    <span className="text-sm font-semibold">{n.title}</span>{" "}
                    <span className="rounded bg-card px-1 font-medium tabular-nums">{n.score.toFixed(3)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {n.caseDesign ? "case-design note" : "domain note"}
                    </span>
                    {n.weakMatch ? <span className="font-medium text-flag"> · weak match</span> : null}
                  </p>
                  {n.excerpt ? (
                    <p className="mt-0.5 truncate text-muted-foreground" title={n.excerpt}>
                      {n.excerpt}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
            {tail.slice(0, tailShown).map((t) => (
              <p key={t.key} className="mt-2 text-muted-foreground">
                {t.node}
              </p>
            ))}
          </>
        )}
        {status}
      </div>
      {done ? footer : null}
    </div>
  );
}
