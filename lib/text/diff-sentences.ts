import type { CaseTextFields } from "@/lib/generation/schema";

// Sentence-level comparison of a rewritten scenario against the original. Moved
// here from components/admin/variant-list.tsx so that the instructor's variant
// cards and the public demo's personalisation step report the same count.

// Titles and short forms that end in a full stop without ending a sentence.
// Kept lower case; the splitter lower-cases the word it looks up.
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "mdm",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "no",
  "nos",
  "inc",
  "ltd",
  "co",
  "corp",
  "pte",
  "plc",
  "bhd",
  "sdn",
  "e.g",
  "i.e",
  "vs",
  "etc",
  "approx",
  "fig",
  "dept",
  "univ",
  "est",
  "al",
  "cf",
]);

// Sentence-level comparison of a variant's scenario against the master's. A
// break needs sentence-final punctuation followed by whitespace, and is held
// back after an abbreviation ("Mr.", "e.g.", "No.") or an initial. A decimal
// point never breaks, because a digit rather than a space follows it.
function splitSentences(text: string): string[] {
  return sentenceSpans(text).map((sp) => text.slice(sp.start, sp.end));
}

// The same split as character ranges, trimmed, so that a renderer can find a
// sentence inside the text of a paragraph it is drawing. Exported for the demo
// columns, which mark the sentences a variant changed.
export function sentenceSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const push = (from: number, to: number) => {
    let a = from;
    let b = to;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) out.push({ start: a, end: b });
  };
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    // Closing quotes, brackets and emphasis markers belong to the sentence
    // that is ending, so step over them before looking for the space.
    let end = i + 1;
    while (end < text.length && "\"')]*_".includes(text[end])) end++;
    if (end < text.length && !/\s/.test(text[end])) continue;
    if (ch === ".") {
      const word = (text.slice(start, i).match(/[A-Za-z.]+$/)?.[0] ?? "")
        .toLowerCase()
        .replace(/^\.+/, "");
      if (ABBREVIATIONS.has(word)) continue;
      // A single letter is an initial, as in "J. Tan".
      if (/^[a-z]$/.test(word)) continue;
    }
    push(start, end);
    start = end;
  }
  push(start, text.length);
  return out;
}

// The scenario as the reader sees it: one block per paragraph or list item, so
// the change view can keep the breaks instead of running everything together.
export interface ScenarioBlock {
  kind: "p" | "li";
  sentences: string[];
}

function splitBlocks(text: string): ScenarioBlock[] {
  const blocks: ScenarioBlock[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const listItem = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    const body = listItem ? listItem[1] : line;
    const sentences = splitSentences(body);
    if (sentences.length === 0) continue;
    blocks.push({ kind: listItem ? "li" : "p", sentences });
  }
  return blocks;
}

function flattenBlocks(blocks: ScenarioBlock[]): string[] {
  return blocks.flatMap((b) => b.sentences);
}

function normaliseSentence(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Longest common subsequence over normalised sentences. Whatever the variant
// holds outside it is what the rewrite changed or added.
function changedSentences(masterSentences: string[], b: string[]): boolean[] {
  const a = masterSentences.map(normaliseSentence);
  const bn = b.map(normaliseSentence);
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(bn.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = bn.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === bn[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const flags = new Array<boolean>(b.length).fill(true);
  let i = 0;
  let j = 0;
  while (i < a.length && j < bn.length) {
    if (a[i] === bn[j]) {
      flags[j] = false;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return flags;
}

// One comparison of a variant's scenario against the master's, shared by the
// card and the open preview so that both report the same count.
export function compareScenario(master: string, variant: string) {
  const blocks = splitBlocks(stripLeadingScenarioHeading(variant));
  const sentences = flattenBlocks(blocks);
  const masterSentences = flattenBlocks(splitBlocks(stripLeadingScenarioHeading(master)));
  const flags = changedSentences(masterSentences, sentences);
  return {
    blocks,
    flags,
    changed: flags.filter(Boolean).length,
    total: sentences.length,
  };
}

// Some drafts still carry a "### Scenario" or "Scenario:" line at the top of the
// scenario field, which the student page renders as a second heading under its
// own. New generations are normalised; this covers the ones already stored.
export function stripLeadingScenarioHeading(s: string): string {
  return s.replace(/^\s*(?:#{1,6}\s+)?\*{0,2}\s*scenario\s*:?\s*\*{0,2}\s*/i, "").trim();
}

// How many of the variant's scenario sentences are not in the master's, by the
// same longest-common-subsequence reading the variant cards show. Only the
// scenario is compared, as on the cards: a case object is read for its
// scenario field.
export function differingSentences(
  master: CaseTextFields | string,
  variant: CaseTextFields | string,
): { differing: number; total: number } {
  const m = typeof master === "string" ? master : master.scenario;
  const v = typeof variant === "string" ? variant : variant.scenario;
  const { changed, total } = compareScenario(m, v);
  return { differing: changed, total };
}

// The sentences of a text in the order the comparison reads them: paragraph by
// paragraph, list markers dropped, a leading "Scenario" heading removed. The
// indices returned by differingSentenceIndices point into this list.
export function comparedSentences(text: string): string[] {
  return flattenBlocks(splitBlocks(stripLeadingScenarioHeading(text)));
}

// Which sentences of `after` are not in `before`, by the same longest common
// subsequence as differingSentences, as indices into comparedSentences(after).
// Its length equals the `differing` count for the same pair of strings.
export function differingSentenceIndices(before: string, after: string): number[] {
  const { flags } = compareScenario(before, after);
  const out: number[] = [];
  flags.forEach((f, i) => {
    if (f) out.push(i);
  });
  return out;
}
