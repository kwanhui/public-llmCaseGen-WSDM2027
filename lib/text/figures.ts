// Figures in a case text: money amounts, percentages, years and other numbers,
// each with a normalised value so that "S$1.2 billion" and "$1,200 million"
// read as the same figure. The demo uses this to say how many of a draft's
// figures a personalised variant kept, and to find figures a student reply
// copied from the case. No model is involved.

export type FigureKind = "money" | "percent" | "year" | "number";

export interface Figure {
  // The figure as written, currency sign and scale word included.
  text: string;
  kind: FigureKind;
  // The number it stands for, scale applied: "1.2 billion" is 1200000000.
  value: number;
  // Where it starts and ends in the source text.
  index: number;
  end: number;
  // Up to 40 characters either side, whitespace collapsed.
  context: string;
}

const SCALE: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  mn: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
  tn: 1e12,
};

// Currency sign or code, the number (with thousands separators or a decimal
// part), an optional scale word, an optional percent sign. The short scale
// letters (m, b, k) only count after a currency, so "5 m" of rope is a plain 5.
const FIGURE_RE =
  /(?<![\p{L}\p{N}.,])(S\$|US\$|C\$|A\$|HK\$|\$|£|€|(?:USD|SGD|CAD|AUD|EUR|GBP|HKD)\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(thousand|million|billion|trillion|mn|bn|tn|m|b|k)(?![\p{L}\p{N}]))?(\s?(?:%|per\s?cent(?![\p{L}])))?/giu;

export function extractFigures(text: string): Figure[] {
  const out: Figure[] = [];
  FIGURE_RE.lastIndex = 0;
  for (const m of text.matchAll(FIGURE_RE)) {
    const [raw, currency, digits, scaleWord, percent] = m;
    const scaleKey = scaleWord?.toLowerCase();
    // A one-letter scale without a currency is a unit, not a scale.
    const scale =
      scaleKey && (scaleKey.length > 2 || currency) ? SCALE[scaleKey] : undefined;
    const base = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    let kind: FigureKind;
    if (percent) kind = "percent";
    else if (currency) kind = "money";
    else if (/^(?:19|20)\d{2}$/.test(digits) && !scale) kind = "year";
    else kind = "number";
    // A lone digit ("three hints", "Question 2") is not a figure; a plain number
    // needs two digits, a separator, a decimal part or a scale word.
    if (kind === "number" && !scale && /^\d$/.test(digits)) continue;
    // A scale letter that was read as a unit is dropped from the shown text.
    const figText = (scaleWord && !scale ? `${currency ?? ""}${digits}${percent ?? ""}` : raw).trim();
    const start = m.index ?? 0;
    out.push({
      text: figText,
      kind,
      value: base * (scale ?? 1),
      index: start,
      end: start + raw.trimEnd().length,
      context: text
        .slice(Math.max(0, start - 40), start + raw.length + 40)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return out;
}

// Money, years and plain numbers share one key, so a figure that lost its
// currency sign in a rewrite still counts as the same figure. Percentages
// stay apart: 40 and 40% are not the same figure.
export function figureKey(f: Figure): string {
  const v = Number(f.value.toPrecision(12));
  return `${f.kind === "percent" ? "pct" : "n"}:${v}`;
}

export interface FigureComparison {
  // Figures of `before` whose value appears in `after`, each used once.
  kept: number;
  // All figures of `before`.
  total: number;
  // Unmatched figures of `before` paired in order with unmatched figures of
  // `after`, at most six pairs.
  changed: { from: string; to: string }[];
  // Every figure of `after` that no figure of `before` accounts for.
  unmatchedAfter: Figure[];
}

export function compareFigures(before: string, after: string): FigureComparison {
  const a = extractFigures(before);
  const b = extractFigures(after);
  const used = new Array<boolean>(b.length).fill(false);
  const unmatchedBefore: Figure[] = [];
  let kept = 0;
  for (const f of a) {
    const key = figureKey(f);
    const j = b.findIndex((g, k) => !used[k] && figureKey(g) === key);
    if (j >= 0) {
      used[j] = true;
      kept++;
    } else {
      unmatchedBefore.push(f);
    }
  }
  const unmatchedAfter = b.filter((_, k) => !used[k]);
  const pairs = Math.min(6, unmatchedBefore.length, unmatchedAfter.length);
  const changed: { from: string; to: string }[] = [];
  for (let i = 0; i < pairs; i++) {
    changed.push({ from: unmatchedBefore[i].text, to: unmatchedAfter[i].text });
  }
  return { kept, total: a.length, changed, unmatchedAfter };
}
