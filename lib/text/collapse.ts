// The first part of a long text, for the demo columns, which show about twelve
// lines and offer the rest on request. A cut falls at the end of a sentence so
// that the visible part never stops mid-sentence.
import type { CaseTextFields } from "@/lib/generation/schema";
import { sentenceSpans } from "./diff-sentences";

export interface CollapseOptions {
  maxLines?: number;
  maxChars?: number;
  // A remainder shorter than this is shown rather than hidden behind a button.
  minHidden?: number;
}

const DEFAULTS = { maxLines: 12, maxChars: 1200, minHidden: 200 };

export interface Collapsed {
  head: string;
  truncated: boolean;
  // Lines (non-empty) and characters the head used, for a caller that shares
  // one budget across several fields.
  lines: number;
  chars: number;
}

function countLines(s: string): number {
  return s.split("\n").filter((l) => l.trim() !== "").length;
}

export function collapseText(text: string, options: CollapseOptions = {}): Collapsed {
  const { maxLines, maxChars, minHidden } = { ...DEFAULTS, ...options };
  const full = text.trimEnd();
  if (maxLines <= 0 || maxChars <= 0) return { head: "", truncated: full.length > 0, lines: 0, chars: 0 };
  // End of the maxLines-th non-empty line.
  let cut = full.length;
  let seen = 0;
  let pos = 0;
  for (const line of full.split("\n")) {
    const end = pos + line.length;
    if (line.trim() !== "") {
      seen++;
      if (seen === maxLines) {
        cut = end;
        break;
      }
    }
    pos = end + 1;
  }
  if (cut > maxChars) {
    const spans = sentenceSpans(full.slice(0, maxChars + 1));
    // The last sentence that ends inside the budget; a sentence that runs to
    // the budget's edge without its own full stop is not finished.
    const done = spans.filter((sp) => sp.end <= maxChars && /[.!?]["')\]*_]*$/.test(full.slice(sp.start, sp.end)));
    if (done.length > 0) cut = done[done.length - 1].end;
    else {
      const space = full.lastIndexOf(" ", maxChars);
      cut = space > 0 ? space : maxChars;
    }
  }
  if (full.length - cut < minHidden) return { head: full, truncated: false, lines: countLines(full), chars: full.length };
  const head = full.slice(0, cut).trimEnd();
  return { head, truncated: true, lines: countLines(head), chars: head.length };
}

// The same budget spread over the four fields in reading order. Fields after
// the one where the budget ran out are left empty; list items are kept whole.
export function collapseFields(
  content: CaseTextFields,
  options: CollapseOptions = {},
): { content: CaseTextFields; truncated: boolean } {
  const opts = { ...DEFAULTS, ...options };
  const total = [content.scenario, ...content.discussionQuestions, ...content.modelAnswers, content.rubric].join("\n\n");
  if (!collapseText(total, opts).truncated) return { content, truncated: false };

  let lines = opts.maxLines;
  let chars = opts.maxChars;
  const out: CaseTextFields = { scenario: "", discussionQuestions: [], modelAnswers: [], rubric: "" };

  const s = collapseText(content.scenario, { ...opts, maxLines: lines, maxChars: chars, minHidden: 0 });
  out.scenario = s.head;
  if (s.truncated) return { content: out, truncated: true };
  lines -= s.lines;
  chars -= s.chars;

  for (const key of ["discussionQuestions", "modelAnswers"] as const) {
    for (const item of content[key]) {
      const l = Math.max(1, countLines(item));
      if (l > lines || item.length > chars) return { content: out, truncated: true };
      out[key].push(item);
      lines -= l;
      chars -= item.length;
    }
  }

  const r = collapseText(content.rubric, { ...opts, maxLines: lines, maxChars: chars, minHidden: 0 });
  out.rubric = r.head;
  return { content: out, truncated: r.truncated };
}
