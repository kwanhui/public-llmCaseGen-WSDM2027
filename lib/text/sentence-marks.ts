// Finding a compared sentence again in rendered text. The comparison in
// diff-sentences.ts reads the markdown source; the demo columns mark the
// sentences a variant changed in the rendered page, where emphasis markers,
// heading hashes and link targets are gone. Both sides are reduced to the same
// key so that a source sentence and its rendered form meet.
import { comparedSentences, differingSentenceIndices, sentenceSpans } from "./diff-sentences";

export function sentenceKey(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/\*\*|__|[*`]/g, "")
    .replace(/(^|\s)_|_(\s|$)/g, "$1$2")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Keys of the sentences of `after` that are not in `before`.
export function changedSentenceKeys(before: string, after: string): Set<string> {
  const sentences = comparedSentences(after);
  const keys = new Set<string>();
  for (const i of differingSentenceIndices(before, after)) {
    const k = sentenceKey(sentences[i] ?? "");
    if (k) keys.add(k);
  }
  return keys;
}

// Sentence ranges of rendered text. The comparison splits the source line by
// line, so a line break ends a sentence here too.
export function renderedSentenceSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    for (const sp of sentenceSpans(line)) out.push({ start: sp.start + offset, end: sp.end + offset });
    offset += line.length + 1;
  }
  return out;
}
