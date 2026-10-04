"use client";

import { createElement, Fragment, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ArmSignals } from "@/lib/generation/compare";

// Marking the matches in the text. The readings say how many concepts and
// notes matched; the marks say where, so that a reader can see that a concept
// named once in a question is not the same as one worked through in an
// answer. The phrases come from the same check that produced the readings.

// One background per must-cover concept, by its position in the brief.
export const CONCEPT_MARK = [
  "bg-[hsl(48_95%_60%/0.45)]",
  "bg-[hsl(150_60%_55%/0.40)]",
  "bg-[hsl(205_85%_65%/0.40)]",
  "bg-[hsl(330_70%_70%/0.40)]",
  "bg-[hsl(20_85%_65%/0.40)]",
  "bg-[hsl(270_60%_70%/0.40)]",
];
export const NOTE_MARK = "underline decoration-dotted decoration-2 decoration-[hsl(205_85%_40%)] underline-offset-2";

export interface HighlightSpec {
  phrase: string;
  kind: "concept" | "note";
  index: number;
  title: string;
}

// Takes anything carrying the two readings the marks come from, so a
// comparison arm, a demo result or a coverage report wrapped as signals all work.
export function highlightSpecs(arm: {
  signals: Pick<ArmSignals, "concepts" | "grounding">;
}): HighlightSpec[] {
  const specs: HighlightSpec[] = [];
  arm.signals.concepts.forEach((c, i) => {
    const phrases =
      c.parts.length > 0 ? c.parts.map((p) => p.matchedPhrase) : [c.matchedPhrase];
    for (const ph of phrases) {
      if (!ph) continue;
      // A quoted match is cut to a maximum length with an ellipsis; each piece
      // is marked on its own.
      for (const piece of ph.split("…")) {
        const t = piece.trim();
        if (t.length >= 3) specs.push({ phrase: t, kind: "concept", index: i, title: `Must-cover concept: ${c.concept}` });
      }
    }
  });
  for (const n of arm.signals.grounding?.notes ?? []) {
    for (const tag of n.matchedTags) {
      if (n.countableTags.includes(tag)) {
        specs.push({ phrase: tag, kind: "note", index: 0, title: `Retrieved note: ${n.title}` });
      }
    }
  }
  return specs;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Case-insensitive, whitespace-tolerant, with a plural allowed on the last
// word. This is looser than the check that produced the phrase, so a marked
// span is where the words are, not a second reading.
export function buildMatcher(specs: HighlightSpec[]): RegExp | null {
  if (specs.length === 0) return null;
  const alts = [...specs]
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .map((s) => escapeRegExp(s.phrase).replace(/\s+/g, "\\s+") + "(?:e?s)?");
  return new RegExp(`(?<![\\p{L}\\p{N}])(${alts.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

export function specFor(match: string, specs: HighlightSpec[]): HighlightSpec | undefined {
  const m = match.toLowerCase().replace(/\s+/g, " ");
  return specs.find((s) => {
    const p = s.phrase.toLowerCase().replace(/\s+/g, " ");
    return m === p || m === `${p}s` || m === `${p}es`;
  });
}

// The small number after a concept mark: the concept's position in the brief,
// so that the concept is not told by colour alone. The legend lists the same
// numbers; a screen reader hears "(concept n)".
export function ConceptIndex({ index }: { index: number }) {
  return (
    <>
      <sup aria-hidden="true" className="ml-px text-[13px] font-semibold leading-none text-muted-foreground">
        {index + 1}
      </sup>
      <span className="sr-only"> (concept {index + 1})</span>
    </>
  );
}

export function markString(text: string, specs: HighlightSpec[], re: RegExp): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const spec = specFor(m[0], specs);
    const concept = spec?.kind === "concept";
    out.push(
      <Fragment key={k++}>
        <mark
          title={spec?.title}
          className={cn(
            "rounded-sm bg-transparent px-0.5 text-inherit",
            concept ? CONCEPT_MARK[spec.index % CONCEPT_MARK.length] : NOTE_MARK,
          )}
        >
          {m[0]}
        </mark>
        {concept ? <ConceptIndex index={spec.index} /> : null}
      </Fragment>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : out;
}

export function markChildren(children: ReactNode, specs: HighlightSpec[], re: RegExp): ReactNode {
  if (typeof children === "string") return markString(children, specs, re);
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === "string" ? <span key={i}>{markString(c, specs, re)}</span> : c,
    );
  }
  return children;
}

// Tables in model output (GitHub-style pipe tables) render as tables, with
// borders, and scroll sideways inside their own wrapper when wide.
const TABLE_CLASSES =
  "[&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-xs [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top";

// Headings in model output sit below the page's own (h1 page, h2 panel, h3
// column, h4 draft block): MarkedMarkdown renders an h1, h2 or h3 of the
// model's as h4 and anything deeper as h5 (demoteHeadings below).
export const MARKDOWN_CLASSES = cn(
  "space-y-3 text-sm leading-relaxed [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-medium [&_h5]:mt-3 [&_h5]:text-sm [&_h5]:font-medium [&_p]:my-2 [&_strong]:font-semibold [&_em]:italic [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
  TABLE_CLASSES,
);

export const REMARK_PLUGINS = [remarkGfm];

// The level a heading of the model's is rendered at: h1 to h3 become h4, h4
// to h6 become h5, so that heading navigation does not land in model text as
// if it were the page's structure. The original level stays on the element as
// data-level.
export function demotedHeading(level: number): "h4" | "h5" {
  return level <= 3 ? "h4" : "h5";
}

// react-markdown overrides for h1 to h6 that demote the level. `inner` maps a
// heading's children, for the concept marks.
export function demoteHeadings(
  inner: (children: ReactNode) => ReactNode = (c) => c,
): Record<"h1" | "h2" | "h3" | "h4" | "h5" | "h6", (props: { children?: ReactNode; node?: unknown } & Record<string, unknown>) => ReactNode> {
  const make = (level: number) => {
    const Demoted = (props: { children?: ReactNode; node?: unknown } & Record<string, unknown>) => {
      const { children, node: _node, ...rest } = props;
      void _node;
      return createElement(demotedHeading(level), { ...rest, "data-level": level }, inner(children));
    };
    Demoted.displayName = `Demoted_h${level}`;
    return Demoted;
  };
  return { h1: make(1), h2: make(2), h3: make(3), h4: make(4), h5: make(5), h6: make(6) };
}

// Markdown rendered as CaseMarkdown does, plus GitHub-style tables, with the
// text of each block element passed through the marker. Elements without an
// override keep plain text.
export function MarkedMarkdown({
  children,
  specs,
  className,
}: {
  children: string;
  specs: HighlightSpec[];
  className?: string;
}) {
  const re = buildMatcher(specs);
  if (!re) {
    return (
      <div className={cn(MARKDOWN_CLASSES, className)}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={demoteHeadings() as unknown as Components}>
          {children}
        </ReactMarkdown>
      </div>
    );
  }
  const wrap = (tag: string) => {
    const Marked = (props: { children?: ReactNode; node?: unknown } & Record<string, unknown>) => {
      const { children: inner, node: _node, ...rest } = props;
      void _node;
      return createElement(tag, rest, markChildren(inner, specs, re));
    };
    Marked.displayName = `Marked_${tag}`;
    return Marked;
  };
  const components = {
    p: wrap("p"),
    li: wrap("li"),
    ...demoteHeadings((inner) => markChildren(inner, specs, re)),
    strong: wrap("strong"),
    em: wrap("em"),
    td: wrap("td"),
    th: wrap("th"),
    blockquote: wrap("blockquote"),
  } as unknown as Components;
  return (
    <div className={cn(MARKDOWN_CLASSES, className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
