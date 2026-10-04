// Which must-cover concepts no retrieved note mentions by name. The Retrieval
// step and the demo's retrieval trace both say so.
//
// It runs the same lexical matcher the concept check runs on the draft
// (checkConceptCoverage), in two directions. First, the concept is looked for
// in the note's title, text and tags, as the concept check looks for it in the
// case. Second, each of the note's own names (its title and its tags of two or
// more words) is looked for in the concept, so that a note titled
// "Strengths-based practice" and tagged "strengths-based" counts as naming the
// concept "strengths-based assessment". A single-word tag ("assessment") is too
// broad to name a concept on its own and is not used this way. Like the concept
// check it matches words, not meaning, so a note that covers a concept in other
// words still reads as not naming it.

import { checkConceptCoverage } from "@/lib/generation/generate-case";
import { normalisedWords } from "@/lib/text/lexical";
import type { CorpusChunk } from "./corpus";

// The same check the concept check runs, over one piece of text.
function textNames(text: string, concept: string, tags: string[] = []): boolean {
  const report = checkConceptCoverage(
    {
      scenario: text,
      discussionQuestions: tags.length > 0 ? [tags.join(", ")] : [],
      modelAnswers: [],
      rubric: "",
    },
    [concept],
  );
  return report.covered.length > 0;
}

// A note's names that can stand for a concept: its title and its tags of two
// or more words.
function noteNames(chunk: CorpusChunk): string[] {
  return [chunk.title, ...chunk.tags].filter((name) => normalisedWords(name).length >= 2);
}

export function noteMentions(chunk: CorpusChunk, concept: string): boolean {
  if (textNames(`${chunk.title}\n${chunk.text}`, concept, chunk.tags)) return true;
  return noteNames(chunk).some((name) => textNames(concept, name));
}

export function conceptsWithoutNote(
  concepts: string[],
  chunks: { chunk: CorpusChunk }[],
): string[] {
  return concepts.filter((c) => !chunks.some(({ chunk }) => noteMentions(chunk, c)));
}
