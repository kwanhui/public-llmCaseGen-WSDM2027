import {
  CORPUS,
  corpusChunkById,
  corpusForDiscipline,
  isCaseDesignNote,
  type CorpusChunk,
} from "./corpus";
import { findPhrase, normalisedWords, tokenise } from "@/lib/text/lexical";
import type { CaseTextFields } from "@/lib/generation/schema";

export interface GroundingTagMatch {
  tag: string;
  // Generic matches are listed but never counted (see tagIsDistinctive).
  distinctive: boolean;
  // The tag's words are already in the brief, so a match on it says nothing
  // about the note. Listed, never counted.
  inBrief: boolean;
}

export interface GroundingNote {
  id: string;
  title: string;
  // At least one distinctive tag of the note, which the brief did not supply,
  // appears in the text.
  reflected: boolean;
  // The reading under the earlier distinctive-tag rule, where a distinctive tag counted whether
  // or not the brief supplied it. Kept so the reports can show both.
  reflectedDistinctiveTag: boolean;
  // The reading under the original any-tag rule.
  reflectedAnyTag: boolean;
  // Whether this note has any tag that could have counted. A note with none is
  // reported as not countable rather than as not reflected.
  countable: boolean;
  // Every tag of the note found in the text, in the note's own order.
  matches: GroundingTagMatch[];
  matchedTags: string[];
  // Distinctive tags found in the text that the brief also carries.
  briefMatches: string[];
  genericMatches: string[];
  tags: string[];
  distinctiveTags: string[];
  // The tags that can count: distinctive, and not supplied by the brief. When
  // this is empty the note is not countable.
  countableTags: string[];
  caseDesign: boolean;
}

export interface GroundingUtilisation {
  used: number;
  // How many of the retrieved notes could have counted. The reading is used of
  // countable; total stays visible so the retrieved set is not hidden.
  countable: number;
  total: number;
  // The earlier reading: distinctive tags, brief or not.
  usedDistinctiveTag: number;
  // The original reading: any tag at all.
  usedAnyTag: number;
  // In retrieval order.
  notes: GroundingNote[];
}

// The brief the draft was written from. Tags it already carries are excluded
// from the count, so the reading is not satisfied by words the instructor
// supplied. CaseInput satisfies this shape.
export interface GroundingBrief {
  learningObjective: string;
  mustCoverConcepts: string[];
  targetLearnerProfile: { industry: string; role: string };
}

// The rule in words, for the interface and for result files.
export const GROUNDING_RULE =
  "Lexical check. A retrieved note counts as reflected when one of its distinctive tags appears in the text and " +
  "is not already in the brief. A tag is distinctive within its discipline corpus when at most two notes carry it " +
  "and it is either a term of two or more words, an acronym, or a single word that only one note of the corpus " +
  "uses. Tags such as \"decision\", \"debt\" or \"neglect\" fail that test, so a match on them is shown but not " +
  "counted. A tag the brief supplies is shown as in the brief and not counted either, because every output " +
  "written from that brief carries it whether or not the note was used. A note left with no tag that could count " +
  "is not countable, and the reading is reported over the countable notes.";

// A tag carried by more notes of a discipline than this says nothing about
// which note a draft drew on.
const MAX_NOTES_PER_TAG = 2;

// Distinctiveness is computed from the corpus, so it follows the corpus when
// notes are added. A tag qualifies as a term of two or more words (hyphens and
// slashes separate words), as an acronym (WACC, DCF), or as a single word that
// the text of exactly one note uses ("genogram" qualifies; "decision", in
// eight finance notes, does not).
function tagIsDistinctive(tag: string, notes: CorpusChunk[]): boolean {
  const key = tag.toLowerCase();
  const carriers = notes.filter((n) => n.tags.some((t) => t.toLowerCase() === key)).length;
  if (carriers > MAX_NOTES_PER_TAG) return false;

  const words = normalisedWords(tag);
  if (words.length === 0) return false;
  if (words.length >= 2) return true;
  if (/[A-Z]{2,}/.test(tag)) return true;

  const inText = notes.filter(
    (n) => findPhrase(tokenise(`${n.title}\n${n.text}`), words) !== null,
  ).length;
  return inText === 1;
}

// The corpus is a fixed module, so this is computed once per discipline.
const distinctiveByDiscipline = new Map<string, Set<string>>();

function distinctiveTagsFor(discipline: CorpusChunk["discipline"]): Set<string> {
  const cached = distinctiveByDiscipline.get(discipline);
  if (cached) return cached;
  const notes = corpusForDiscipline(discipline);
  const set = new Set<string>();
  for (const note of notes) {
    for (const tag of note.tags) {
      if (tagIsDistinctive(tag, notes)) set.add(tag.toLowerCase());
    }
  }
  distinctiveByDiscipline.set(discipline, set);
  return set;
}

export function isDistinctiveTag(
  tag: string,
  discipline: CorpusChunk["discipline"],
): boolean {
  return distinctiveTagsFor(discipline).has(tag.toLowerCase());
}

// Counts per discipline, for scripts/grounding-report.ts.
export function distinctiveTagSummary(): {
  discipline: string;
  notes: number;
  tags: number;
  distinctive: number;
  notesWithNoDistinctiveTag: string[];
}[] {
  const disciplines = [...new Set(CORPUS.map((c) => c.discipline))];
  return disciplines.map((d) => {
    const notes = corpusForDiscipline(d);
    const all = new Set(notes.flatMap((n) => n.tags.map((t) => t.toLowerCase())));
    const distinctive = distinctiveTagsFor(d);
    return {
      discipline: d,
      notes: notes.length,
      tags: all.size,
      distinctive: distinctive.size,
      notesWithNoDistinctiveTag: notes
        .filter((n) => !n.tags.some((t) => distinctive.has(t.toLowerCase())))
        .map((n) => n.id),
    };
  });
}

// Provenance entries look like `corpus:fin-ddm (0.512)`. Model and pack entries
// are skipped.
export function provenanceChunkIds(provenance: string[]): string[] {
  return provenance
    .filter((p) => p.startsWith("corpus:"))
    .map((p) => p.slice("corpus:".length).split(" ")[0]);
}

// Uses the same word normalisation as the must-cover check, so that the two
// checks agree on "least-restrictive setting" and "least restrictive setting".
function tagAppears(textTokens: ReturnType<typeof tokenise>, tag: string): boolean {
  const words = normalisedWords(tag);
  return words.length > 0 && findPhrase(textTokens, words) !== null;
}

// The text of the brief the draft was written from, matched with the same
// normalisation as the tags themselves.
export function briefText(brief: GroundingBrief): string {
  return [
    brief.learningObjective,
    brief.mustCoverConcepts.join(", "),
    brief.targetLearnerProfile.industry,
    brief.targetLearnerProfile.role,
  ].join("\n");
}

// Which retrieved notes a text reflects: a note counts when one of its
// distinctive tags appears and the brief did not already supply that tag. This
// matches words, not meaning. The generation route, the contrastive view, the
// Retrieval step and scripts/grounding-report.ts all call this function, so the
// interface and the result files report the same figure. The two earlier
// readings are returned beside it: `usedDistinctiveTag` counts a distinctive
// tag whether or not the brief carries it, and `usedAnyTag` counts any tag.
export function groundingUtilisation(
  output: CaseTextFields,
  provenance: string[],
  brief: GroundingBrief,
): GroundingUtilisation {
  const haystack = [
    output.scenario,
    output.discussionQuestions.join(" "),
    output.modelAnswers.join(" "),
    output.rubric,
  ].join(" ");
  const tokens = tokenise(haystack);
  const briefTokens = tokenise(briefText(brief));
  const ids = provenanceChunkIds(provenance);
  const notes: GroundingNote[] = [];
  let used = 0;
  let usedDistinctiveTag = 0;
  let usedAnyTag = 0;
  let countable = 0;
  for (const id of ids) {
    const chunk = corpusChunkById(id);
    if (!chunk) continue;
    const distinctive = distinctiveTagsFor(chunk.discipline);
    const isCountableTag = (t: string) =>
      distinctive.has(t.toLowerCase()) && !tagAppears(briefTokens, t);
    const matches: GroundingTagMatch[] = chunk.tags
      .filter((t) => tagAppears(tokens, t))
      .map((t) => ({
        tag: t,
        distinctive: distinctive.has(t.toLowerCase()),
        inBrief: tagAppears(briefTokens, t),
      }));
    const matchedTags = matches.filter((m) => m.distinctive && !m.inBrief).map((m) => m.tag);
    const briefMatches = matches.filter((m) => m.distinctive && m.inBrief).map((m) => m.tag);
    const genericMatches = matches.filter((m) => !m.distinctive).map((m) => m.tag);
    const countableTags = chunk.tags.filter(isCountableTag);
    if (matchedTags.length > 0) used++;
    if (matchedTags.length + briefMatches.length > 0) usedDistinctiveTag++;
    if (matches.length > 0) usedAnyTag++;
    if (countableTags.length > 0) countable++;
    notes.push({
      id: chunk.id,
      title: chunk.title,
      reflected: matchedTags.length > 0,
      reflectedDistinctiveTag: matchedTags.length + briefMatches.length > 0,
      reflectedAnyTag: matches.length > 0,
      countable: countableTags.length > 0,
      matches,
      matchedTags,
      briefMatches,
      genericMatches,
      tags: chunk.tags,
      distinctiveTags: chunk.tags.filter((t) => distinctive.has(t.toLowerCase())),
      countableTags,
      caseDesign: isCaseDesignNote(chunk.id),
    });
  }
  return { used, countable, total: ids.length, usedDistinctiveTag, usedAnyTag, notes };
}
