"use client";

import Image from "next/image";
import { Fragment, useId, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface Shot {
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface Stage {
  label: string;
  // Two sentences, shown in the lane's panel when the box is open. Every
  // stage's detail is in the DOM (hidden until its box is open) and is the
  // box's accessible description, so a screen reader meets the diagram once.
  detail: string;
  shot: Shot;
  // A stage beside the main sequence, drawn dashed (the contrastive view).
  aside?: boolean;
}

// A thin connector between two nodes: horizontal from md up, vertical below
// md where the nodes stack. With arrow it ends in a small arrowhead.
export function Chevron({
  down = false,
  arrow = true,
  tone = "primary",
  style,
}: {
  down?: boolean;
  arrow?: boolean;
  tone?: "primary" | "student";
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 12"
      style={style}
      preserveAspectRatio="none"
      className={cn(
        "order-[var(--o)] h-3 w-6 shrink-0 self-center md:order-none",
        tone === "primary" ? "text-primary/45" : "text-student/45",
        down ? "rotate-90" : "rotate-90 md:rotate-0",
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 6h21" vectorEffect="non-scaling-stroke" />
      {arrow ? <path d="M18 2.5L22 6l-4 3.5" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

// "1 Input" -> ["1", "Input"]; a label without a number keeps it whole. The
// number is drawn in a small disc, and the text content stays "1 Input".
function splitLabel(label: string): [string | null, string] {
  const m = /^(\d+)\s+(.*)$/.exec(label);
  return m ? [m[1], m[2]] : [null, label];
}

// "1 Input" -> "Input"; "Open the team link" -> "team link", so that the link
// name does not read "Open the Open the ...".
function shotName(label: string) {
  return label.replace(/^\d+\s+/, "").replace(/^Open the\s+/, "");
}

// The CSS order of an item below md, where the panel sits directly under the
// open box. From md up every item keeps its document order and the panel,
// last in the lane, spans the lane's full width.
const order = (n: number) => ({ "--o": n }) as CSSProperties;

interface LaneProps {
  lane: "instructor" | "student";
  stages: Stage[];
  // Index of the open stage, or null for none. The diagram holds one selection
  // for both lanes, so opening a stage in one lane closes the other lane's.
  open: number | null;
  onOpen: (index: number) => void;
  // Index of the main-sequence stage the aside stage sits under.
  asideAfter?: number;
}

export function StageLane({ lane, stages, open, onOpen: setOpen, asideAfter }: LaneProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const detailId = (i: number) => `${baseId}-detail-${i}`;
  const instructor = lane === "instructor";

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = stages.length - 1;
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = i === last ? 0 : i + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = i === 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    buttons.current[next]?.focus();
  }

  // Below md: box i has order 10i+2 (its chevron 10i+1), an aside stage sits
  // at 10a+3 after main stage a, and the panel follows the open box.
  const mainIndex = stages.filter((s) => !s.aside);
  const orderOf = (i: number) => {
    const s = stages[i];
    if (s.aside) return 10 * (asideAfter ?? 0) + 3;
    return 10 * mainIndex.indexOf(s) + 2;
  };

  const selected = open === null ? null : stages[open];

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        instructor
          ? "md:grid md:grid-cols-[repeat(4,minmax(0,1fr)_auto)_minmax(0,1fr)] md:items-center md:gap-x-1 md:gap-y-4"
          : "md:flex-row md:flex-wrap md:items-center md:gap-x-1 md:gap-y-4",
      )}
    >
      {stages.map((s, i) => {
        const isOpen = open === i;
        const mi = mainIndex.indexOf(s);
        const [num, name] = splitLabel(s.label);
        return (
          <Fragment key={s.label}>
            {!s.aside && mi > 0 ? (
              <Chevron
                style={order(10 * mi + 1)}
                arrow={instructor}
                tone={instructor ? "primary" : "student"}
              />
            ) : null}
            <button
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              aria-describedby={detailId(i)}
              // A second click on the open box keeps it open.
              onClick={() => setOpen(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              style={order(orderOf(i))}
              className={cn(
                "group relative order-[var(--o)] flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-left text-sm font-semibold leading-snug md:order-none",
                "transition-[background-color,border-color,color,box-shadow] duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                instructor
                  ? s.aside
                    ? // Beside the sequence, under stage 4: dashed, with a dashed
                      // stub up to its node from md up.
                      "border-dashed border-primary/50 bg-transparent text-foreground hover:bg-card md:col-start-7 md:row-start-2 md:before:absolute md:before:-top-4 md:before:left-1/2 md:before:h-4 md:before:border-l md:before:border-dashed md:before:border-primary/50"
                    : "border-primary/25 bg-card text-foreground shadow-xs hover:border-primary/60 md:self-stretch"
                  : "border-student/25 bg-card text-foreground shadow-xs hover:border-student/60 md:min-w-0 md:flex-1 md:self-stretch",
                isOpen &&
                  (instructor
                    ? "border-primary bg-primary text-primary-foreground shadow-sm hover:border-primary hover:bg-primary"
                    : "border-student bg-student text-student-foreground shadow-sm hover:border-student hover:bg-student"),
              )}
            >
              {num ? (
                <>
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
                      isOpen
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {num}
                  </span>{" "}
                  <span className="min-w-0">{name}</span>
                </>
              ) : (
                <span className="min-w-0 px-1">{name}</span>
              )}
            </button>
          </Fragment>
        );
      })}

      <div
        id={panelId}
        role="region"
        aria-label={selected ? selected.label : undefined}
        hidden={selected === null}
        style={open === null ? undefined : order(orderOf(open) + 1)}
        className={cn(
          "order-[var(--o)] mt-1.5 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:order-none md:mt-2 md:p-6",
          instructor ? "md:col-span-full md:row-start-3" : "md:basis-full",
        )}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
          {/* Every detail stays in the DOM as its box's description; only the
              open box's detail is shown. */}
          <div className="min-w-0 md:flex-1">
            {selected ? (
              <p
                aria-hidden="true"
                className={cn(
                  "mb-2 text-xs font-semibold uppercase tracking-[0.06em]",
                  instructor ? "text-primary" : "text-student",
                )}
              >
                {shotName(selected.label)}
              </p>
            ) : null}
            {stages.map((s, i) => (
              <p
                key={s.label}
                id={detailId(i)}
                hidden={open !== i}
                className="max-w-prose text-base leading-relaxed text-muted-foreground"
              >
                {s.detail}
              </p>
            ))}
          </div>
          {selected ? (
            // The thumbnail is too small to read on a phone; it opens the full
            // screenshot in a new tab, and the caption under it says so.
            <a
              key={selected.shot.src}
              href={selected.shot.src}
              target="_blank"
              rel="noopener"
              aria-label={`Open the ${shotName(selected.label)} screenshot at full size (opens in a new tab)`}
              className="group block w-full shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:w-[420px]"
            >
              <Image
                src={selected.shot.src}
                width={selected.shot.width}
                height={selected.shot.height}
                alt={selected.shot.alt}
                sizes="(min-width: 768px) 420px, 100vw"
                // The instructor lane opens on first render, above the fold.
                loading={instructor ? "eager" : "lazy"}
                className="h-auto w-full rounded-lg border bg-background shadow-xs transition-shadow group-hover:shadow-md"
              />
              <span
                className={cn(
                  "mt-2 block text-sm underline underline-offset-2",
                  instructor ? "text-primary" : "text-student",
                )}
              >
                Open at full size
              </span>
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
