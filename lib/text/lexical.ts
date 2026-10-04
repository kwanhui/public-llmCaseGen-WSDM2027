// The word-level matching both lexical checks run on: the must-cover concept
// check in lib/generation/generate-case.ts and the note-reflection check in
// lib/retrieval/grounding.ts. The two share this module so that a string one
// check treats as a match is a match for the other as well (a tag written
// "least-restrictive setting" matches the text "least restrictive setting").
//
// Nothing here looks at meaning. It is spelling and word-form matching.

// Word normalisation, applied in the same way to the pattern and to the text.
// These are a few suffix rules, not a full stemmer, so that they can be stated
// in the interface.
//
//   1. z becomes s, which covers -ize/-ise, -ization/-isation and -yze/-yse.
//   2. -our becomes -or after three or more letters ("behaviour", not "four").
//   3. Plurals: -ies to -y, -(s|ss|sh|ch|x)es to the stem, and a trailing -s
//      unless the word ends in -ss, -us or -is.
//   4. -sis to -s, so "analysis", "analyses" and "analyse" all reach "analys".
//   5. One derivational suffix: -ing, -ed, -ion or -ive, so that "accretion"
//      meets "accretive". It also merges pairs like "position" and "positive".
//   6. A trailing -e.
//   7. A doubled final consonant is collapsed ("planning" meets "plan"). It
//      runs last, so that "sells" and "selling" still meet.
//   8. American and British spellings that the steps above leave apart are
//      mapped to one form, after the stem step (see SPELLING_VARIANTS):
//      -er/-re for a short list of words ("centered" and "centred" both reach
//      "centr"), -our/-or once a suffix is removed or before a further one
//      ("coloured" meets "colored", "behavioural" meets "behavioral"), and -logue/-log ("dialogue" meets "dialog"). The
//      -ize/-ise, -ization/-isation and -yze/-yse pairs are already covered by
//      step 1, and -our/-or at the end of a word by step 2.
//
// Every step keeps a minimum stem length, so short words are left alone.

// Step 8. The -er/-re words are listed one by one rather than handled by a
// rule, because "-er" ends far more words ("water", "manager") than it spells
// a British "-re". Each entry maps the stemmed American form to the stemmed
// British one.
const ER_RE_STEMS: Record<string, string> = {
  center: "centr",
  theater: "theatr",
  fiber: "fibr",
  somber: "sombr",
  caliber: "calibr",
  meager: "meagr",
  saber: "sabr",
  liter: "litr",
  luster: "lustr",
  specter: "spectr",
};

export const SPELLING_VARIANTS = {
  erRe: ER_RE_STEMS,
  // "colour-(ed)", "behaviour-al", "honour-abl(e)", "colour-ful", "labour-er",
  // "favour-it(e)", "savour-y". Step 2 only sees the word before the stem step,
  // so "coloured" still reaches "colour" there. Three letters must come before
  // "our", so "hourly" and "journal" are left alone.
  ourBeforeSuffix: /^([a-z]{3,})our(abl|al|er|ful|ist|it|less|y)?$/,
  // "dialogue", "catalogue" and "analogue" reach "-logu" once the trailing e is
  // removed.
  logue: /^([a-z]{2,})logu$/,
};

function mapSpellingVariant(w: string): string {
  const er = ER_RE_STEMS[w];
  if (er) return er;
  if (SPELLING_VARIANTS.ourBeforeSuffix.test(w)) {
    return w.replace(SPELLING_VARIANTS.ourBeforeSuffix, "$1or$2");
  }
  if (SPELLING_VARIANTS.logue.test(w)) return w.replace(SPELLING_VARIANTS.logue, "$1log");
  return w;
}

export function normaliseWord(raw: string): string {
  let w = raw.toLowerCase().replace(/z/g, "s");
  w = w.replace(/^([a-z]{3,})our(s?)$/, "$1or$2");
  if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + "y";
  else if (/(ss|sh|ch|x|s)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (/s$/.test(w) && !/(ss|us|is)$/.test(w) && w.length > 3) w = w.slice(0, -1);
  if (/sis$/.test(w) && w.length > 4) w = w.slice(0, -2);
  for (const suffix of ["ing", "ion", "ive", "ed"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  if (/([bdfglmnprt])\1$/.test(w) && w.length > 3) w = w.slice(0, -1);
  return mapSpellingVariant(w);
}

export interface LexicalToken {
  word: string;
  start: number;
  end: number;
}

// Hyphens, slashes, brackets and whitespace all separate words, so
// "cost-of-equity" and "cost of equity" tokenise the same way.
export function tokenise(text: string, offset = 0): LexicalToken[] {
  const tokens: LexicalToken[] = [];
  const re = /[A-Za-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({
      word: normaliseWord(m[0]),
      start: offset + m.index,
      end: offset + m.index + m[0].length,
    });
  }
  return tokens;
}

export function normalisedWords(text: string): string[] {
  return tokenise(text).map((t) => t.word);
}

// Sentence boundaries: end punctuation followed by whitespace or the end of the
// text (so a decimal point is not a boundary), and line breaks. Concepts are
// matched inside one sentence, so that words in neighbouring sentences do not
// count as a match.
export function splitSentences(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const re = /[.!?;:]+["')\]]*(?=\s|$)|\n+/g;
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (end > from) spans.push({ start: from, end });
    from = re.lastIndex;
  }
  if (from < text.length) spans.push({ start: from, end: text.length });
  return spans;
}

// The pattern's words appearing in order and adjacent, for example "terminal
// value" in "...is a terminal value, so...".
export function findPhrase(
  tokens: LexicalToken[],
  phrase: string[],
): { from: number; to: number } | null {
  if (phrase.length === 0) return null;
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j].word !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return { from: i, to: i + phrase.length - 1 };
  }
  return null;
}

// The shortest run of text holding at least one of every required word, as a
// token index range. Null when some required word never appears.
export function smallestWindow(
  tokens: LexicalToken[],
  required: string[],
): { from: number; to: number; length: number } | null {
  const need = new Set(required);
  const seen = new Map<string, number>();
  let have = 0;
  let left = 0;
  let best: { from: number; to: number; length: number } | null = null;

  for (let right = 0; right < tokens.length; right++) {
    const w = tokens[right].word;
    if (need.has(w)) {
      const n = (seen.get(w) ?? 0) + 1;
      seen.set(w, n);
      if (n === 1) have++;
    }
    while (have === need.size) {
      const length = right - left + 1;
      if (!best || length < best.length) best = { from: left, to: right, length };
      const lw = tokens[left].word;
      if (need.has(lw)) {
        const n = (seen.get(lw) ?? 0) - 1;
        seen.set(lw, n);
        if (n === 0) have--;
      }
      left++;
    }
  }
  return best;
}

// The stretch of source text that a match covers, shown beside the result.
export function quote(
  text: string,
  tokens: LexicalToken[],
  from: number,
  to: number,
  maxChars: number,
): string {
  const slice = text.slice(tokens[from].start, tokens[to].end).replace(/\s+/g, " ").trim();
  return slice.length > maxChars ? slice.slice(0, maxChars - 1) + "…" : slice;
}
