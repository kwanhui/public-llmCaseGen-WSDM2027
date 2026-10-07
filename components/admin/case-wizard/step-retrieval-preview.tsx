import Link from "next/link";
import type { ReactNode } from "react";
import { getDisciplinePack } from "@/lib/disciplines";
import type { DisciplineId, Difficulty } from "@/lib/disciplines/types";
import type { RejectedChunk, RetrievalPreview } from "@/lib/retrieval/embedding-provider";
import { isCaseDesignNote } from "@/lib/retrieval/corpus";
import { conceptsWithoutNote, noteMentions } from "@/lib/retrieval/concept-notes";
import type { GroundingUtilisation } from "@/lib/retrieval/grounding";
import { buttonClass } from "@/components/ui/button";
import { EditBriefForm } from "@/components/admin/edit-brief-form";
import { CARD, NUM, PILL_FLAG, TABLE, TD, TH, THEAD_ROW, TR } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

const H3 = "text-base font-semibold";
const QUOTE = "border-l-2 border-primary/40 pl-3";

interface Props {
  caseId: string;
  discipline: DisciplineId;
  difficulty: Difficulty;
  retrieval: RetrievalPreview;
  corpusSize: number;
  brief: {
    learningObjective: string;
    difficulty: Difficulty;
    mustCoverConcepts: string[];
    targetLearnerProfile: { industry: string; role: string; priorKnowledge: string };
  };
  briefLocked: boolean;
  // Per-note grounding for the draft the case already holds, computed against
  // the passages that actually conditioned it. Null before a draft exists.
  draftGrounding: GroundingUtilisation | null;
  // False on an example case, where Duplicate is the primary button.
  primaryNext?: boolean;
  // Approved or released: the text is "the case" rather than "the draft".
  approved?: boolean;
  // Shown under the summary line and "Continue to generation" (the
  // co-instructor note box), so the next action comes first.
  afterSummary?: ReactNode;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

// "a", "a and b", "a, b and c".
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// The one line an instructor reads first: how many notes matched, and which
// must-cover concepts no retrieved note names. The second half reports a word
// check (lib/retrieval/concept-notes.ts, the must-cover check run over each
// note's title, text and tags), so it says "by name" and nothing about what a
// note is about: a note can cover a concept in other words. When a note left
// out does name such a concept, the line says so here, once, rather than in a
// paragraph further down.
function summaryLine(
  noteCount: number,
  concepts: string[],
  uncovered: string[],
  namedBelow: { concept: string; title: string; belowThreshold: boolean }[],
  minScore: number,
): string {
  const notes =
    noteCount === 0
      ? "No note matched your brief."
      : `${noteCount === 1 ? "One note" : `${numberWord(noteCount).replace(/^./, (c) => c.toUpperCase())} notes`} matched your brief.`;
  if (concepts.length === 0 || noteCount === 0) return notes;
  if (uncovered.length === 0) {
    return concepts.length === 1
      ? `${notes} The retrieved notes mention the must-cover concept by name.`
      : `${notes} The retrieved notes mention all ${numberWord(concepts.length)} must-cover concepts by name.`;
  }
  const missing = `${notes} The retrieved notes do not mention ${joinAnd(uncovered)} by name; a note may still cover ${
    uncovered.length === 1 ? "it" : "them"
  } in other words, and otherwise the model writes from its own knowledge.`;
  const named = namedBelow.map(({ concept, title, belowThreshold }) => {
    const which = uncovered.length === 1 ? "it" : concept;
    return belowThreshold
      ? ` A note that names ${which}, ${title}, scored below the ${minScore.toFixed(2)} threshold.`
      : ` A note that names ${which}, ${title}, ranked below the ${numberWord(noteCount)} taken.`;
  });
  return missing + named.join("");
}

// A retrieved note's reading against the current draft.
function reflectedCell(
  draftGrounding: GroundingUtilisation | null,
  note: GroundingUtilisation["notes"][number] | undefined,
  text: string,
) {
  if (!draftGrounding) return <span className="text-muted-foreground">no draft yet</span>;
  if (!note) return <span className="text-muted-foreground">not given to the {text}</span>;
  if (!note.countable) return <span className="text-muted-foreground">not countable</span>;
  return note.reflected ? "reflected" : <span className="text-flag">not reflected</span>;
}

// Which tags decided the reading, shown with the note's text.
function tagsSentence(n: GroundingUtilisation["notes"][number], text: string): string {
  const main =
    n.matchedTags.length > 0
      ? `Matched in the ${text}: ${n.matchedTags.join(", ")}.`
      : n.distinctiveTags.length === 0
        ? `This note has no distinctive tag, so it cannot be counted: ${n.tags.join(", ")}.`
        : n.countableTags.length === 0
          ? `Every distinctive tag of this note is already in the brief, so it cannot be counted: ${n.distinctiveTags.join(", ")}.`
          : `None of the distinctive tags that could count appear in the ${text}: ${n.countableTags.join(", ")}.`;
  const brief = n.briefMatches.length > 0 ? ` Also found, but in the brief: ${n.briefMatches.join(", ")}.` : "";
  const generic =
    n.genericMatches.length > 0 ? ` Also found, but too generic to count: ${n.genericMatches.join(", ")}.` : "";
  return main + brief + generic;
}

// Why a note was left out, written from the figures on this screen: its own
// score, the threshold, the lowest score among the notes that were taken, and
// the rule that applied. It does not claim that a capped case-design note
// scored above the notes that were taken, which is false whenever the corpus
// covers the brief well.
function rejectionClause(rejected: RejectedChunk, retrieval: RetrievalPreview): string {
  const min = retrieval.minScore.toFixed(2);
  if (rejected.reason === "below-threshold") {
    return `, below the ${min} threshold`;
  }
  const lowest = retrieval.lowestTakenScore;
  const against =
    lowest === null
      ? ""
      : rejected.score > lowest
        ? `, above the lowest note taken (${lowest.toFixed(3)})`
        : rejected.score < lowest
          ? `, below the lowest note taken (${lowest.toFixed(3)})`
          : `, level with the lowest note taken (${lowest.toFixed(3)})`;
  return rejected.reason === "case-design-cap"
    ? `, at or above the ${min} threshold${against}, but generation takes at most one case-design note and that slot was filled`
    : `, at or above the ${min} threshold${against}, and the ${retrieval.budget} slots were already filled`;
}

function rejectionSentence(rejected: RejectedChunk, retrieval: RetrievalPreview): string {
  return `${rejectionClause(rejected, retrieval)}.`;
}

export function StepRetrievalPreview({
  caseId,
  discipline,
  difficulty,
  retrieval,
  corpusSize,
  brief,
  briefLocked,
  draftGrounding,
  primaryNext = true,
  approved = false,
  afterSummary,
}: Props) {
  const pack = getDisciplinePack(discipline);
  // "Draft" names the text only before approval; after it, "case".
  const text = approved ? "case" : "draft";
  const { chunks: retrieved, embedded, firstRejected, firstOverBudget } = retrieval;
  // A case-design note outranks the domain notes on almost any brief, so the
  // statistics below are taken over the domain-concept notes. Reading them over
  // all five would hide a brief the corpus does not cover: the best match would
  // be a note about how to write a case, not about the subject. The per-note
  // weak mark in the table is unaffected.
  const domainNotes = retrieved.filter((r) => !isCaseDesignNote(r.chunk.id));
  const topDomainScore = domainNotes.length > 0 ? domainNotes[0].score : 0;
  const topScoreIsLow =
    embedded && domainNotes.length > 0 && topDomainScore < retrieval.weakScore;
  // How many of the retrieved domain notes are weak matches, and which of the
  // instructor's concepts no retrieved note mentions. Both are lexical readings
  // over the notes above, computed here rather than at generation time so they
  // are visible before a model call is made.
  const weakCount = domainNotes.filter((r) => r.score < retrieval.weakScore).length;
  const uncoveredConcepts = embedded
    ? conceptsWithoutNote(brief.mustCoverConcepts, retrieved)
    : [];
  // For a concept no retrieved note mentions, the best-scoring note of this
  // discipline that does mention it, with the rule that left it out. The
  // ranking does not use the must-cover concepts, so such a note can sit just
  // under the cut-off without anything on the screen connecting the two facts.
  const uncoveredWithNote = uncoveredConcepts
    .map((concept) => {
      const note = retrieval.leftOut.find((r) => noteMentions(r.chunk, concept));
      return note ? { concept, note } : null;
    })
    .filter((x): x is { concept: string; note: (typeof retrieval.leftOut)[number] } =>
      x !== null,
    );
  // The notes the "Notes left out" disclosure names, counted once each.
  const leftOutCount = new Set(
    [
      firstRejected?.chunk.id,
      firstRejected?.reason === "case-design-cap" ? firstOverBudget?.chunk.id : undefined,
      ...uncoveredWithNote.map(({ note }) => note.chunk.id),
    ].filter((x): x is string => typeof x === "string"),
  ).size;
  // The Match column only has something to say when a note is weak.
  const anyWeak = retrieved.some((r) => r.score < retrieval.weakScore);
  // Notes the current draft was generated from that the list no longer holds,
  // which happens when the brief changed after generation.
  const draftOnly =
    draftGrounding?.notes.filter((n) => !retrieved.some((r) => r.chunk.id === n.id)) ?? [];

  return (
    <div className="space-y-6">
      {!briefLocked ? <EditBriefForm caseId={caseId} initial={brief} /> : null}
      <div className="space-y-3">
        {embedded ? (
          <p className="max-w-3xl text-base font-medium">
            {summaryLine(
              retrieved.length,
              brief.mustCoverConcepts,
              uncoveredConcepts,
              uncoveredWithNote.map(({ concept, note }) => ({
                concept,
                title: note.chunk.title,
                belowThreshold: note.reason === "below-threshold",
              })),
              retrieval.minScore,
            )}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/admin/cases/${caseId}?step=3`}
            className={buttonClass(primaryNext ? "primary" : "outline", "md")}
          >
            Continue to generation
          </Link>
        </div>
      </div>
      {afterSummary}

      <section className={cn(CARD, "overflow-hidden")}>
        <h3 className={cn(H3, "px-4 pt-4 sm:px-5 sm:pt-5")}>
          Retrieved notes
        </h3>
        {draftGrounding ? (
          <p className="mt-1 px-4 text-sm sm:px-5">
            <span className="font-medium">
              Notes reflected: {draftGrounding.used}/{draftGrounding.countable}
            </span>{" "}
            <span className="text-muted-foreground">
              (over the countable notes given to the {text})
            </span>
          </p>
        ) : null}
        {topScoreIsLow ? (
          <p className="mx-4 mt-2 text-sm text-flag sm:mx-5">
            The best domain-concept note scores {topDomainScore.toFixed(3)}, below the{" "}
            {retrieval.weakScore.toFixed(2)} weak-match line. The corpus may not cover
            this brief well. Read the notes below before generating.
          </p>
        ) : null}
        {embedded ? (
          <div className="mt-3 space-y-3">
            <div className="overflow-x-auto border-y">
              <table className={TABLE}>
                <thead>
                  <tr className={cn(THEAD_ROW, "bg-muted/40")}>
                    <th scope="col" className={cn(TH, "w-12")}>
                      Rank
                    </th>
                    <th scope="col" className={TH}>
                      Note
                    </th>
                    <th scope="col" className={TH}>
                      Type
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Similarity
                    </th>
                    {anyWeak ? (
                      <th scope="col" className={TH}>
                        Match
                      </th>
                    ) : null}
                    <th scope="col" className={TH}>
                      Reflected in the {text}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {retrieved.map((r, i) => {
                    const inDraft = draftGrounding?.notes.find((n) => n.id === r.chunk.id);
                    return (
                      <tr key={r.chunk.id} className={TR}>
                        <td className={cn(TD, "tabular-nums text-muted-foreground")}>{i + 1}</td>
                        <td className={TD}>
                          <details>
                            <summary className="cursor-pointer rounded-sm">
                              <span className="font-medium">{r.chunk.title}</span>{" "}
                              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                                {r.chunk.id}
                              </span>
                            </summary>
                            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
                              {r.chunk.text}
                            </p>
                            {inDraft ? (
                              <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
                                {tagsSentence(inDraft, text)}
                              </p>
                            ) : null}
                          </details>
                        </td>
                        <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
                          {isCaseDesignNote(r.chunk.id) ? "Case design" : "Domain concept"}
                        </td>
                        <td className={cn(TD, NUM, "whitespace-nowrap font-medium")}>
                          {r.score.toFixed(3)}
                        </td>
                        {anyWeak ? (
                          <td className={cn(TD, "whitespace-nowrap")}>
                            {r.score < retrieval.weakScore ? (
                              <span className={PILL_FLAG}>weak</span>
                            ) : null}
                          </td>
                        ) : null}
                        <td className={cn(TD, "whitespace-nowrap")}>
                          {reflectedCell(draftGrounding, inDraft, text)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
            <p className="text-sm text-muted-foreground">
              Select a note&apos;s title to read its text and the tags that were matched.
            </p>
            {leftOutCount > 0 ? (
              <details className="text-sm">
                <summary className="w-fit cursor-pointer rounded-sm font-medium text-primary">
                  Notes left out ({leftOutCount})
                </summary>
                <div className="mt-2 max-w-prose space-y-2">
                {firstRejected ? (
                  <p className="text-sm text-muted-foreground">
                    First note left out:{" "}
                    <span className="font-medium text-foreground">
                      {firstRejected.chunk.title}
                    </span>{" "}
                    <span className="font-mono">
                      {firstRejected.score.toFixed(3)} · {firstRejected.chunk.id}
                    </span>
                    {rejectionSentence(firstRejected, retrieval)}
                  </p>
                ) : null}
                {firstRejected?.reason === "case-design-cap" && firstOverBudget ? (
                  <p className="text-sm text-muted-foreground">
                    First domain note left out on budget:{" "}
                    <span className="font-medium text-foreground">
                      {firstOverBudget.chunk.title}
                    </span>{" "}
                    <span className="font-mono">
                      {firstOverBudget.score.toFixed(3)} · {firstOverBudget.chunk.id}
                    </span>
                    .
                  </p>
                ) : null}
                {uncoveredWithNote.map(({ concept, note }) => (
                  <p key={concept} className="text-sm text-muted-foreground">
                    A note of this corpus does mention{" "}
                    <span className="text-foreground">{concept}</span>, and it was not
                    retrieved:{" "}
                    <span className="font-medium text-foreground">{note.chunk.title}</span>{" "}
                    <span className="font-mono">
                      {note.score.toFixed(3)} · {note.chunk.id}
                    </span>
                    {rejectionClause(note, retrieval)}. The ranking scores the whole brief and
                    does not reserve a slot per concept.
                  </p>
                ))}
                </div>
              </details>
            ) : null}
            {weakCount >= 3 ? (
              <p className="text-sm text-flag">
                {weakCount} of the {domainNotes.length} domain-concept notes taken score
                below the {retrieval.weakScore.toFixed(2)} weak-match line. On this brief
                the corpus is contributing little, and the {text} rests mostly on the
                model.
              </p>
            ) : null}
            {draftOnly.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                The {approved ? "case" : "current draft"} was generated from notes this list
                no longer holds, since the brief has changed: {draftOnly.map((n) => n.title).join(", ")}.
              </p>
            ) : null}
            <details className="text-sm">
              <summary className="w-fit cursor-pointer rounded-sm font-medium text-primary">
                How retrieval works
              </summary>
              <div className="mt-2 max-w-prose space-y-2 leading-relaxed text-muted-foreground">
                <p>
                  The brief is embedded with{" "}
                  <code className="font-mono text-xs">text-embedding-3-small</code> and scored
                  by cosine similarity against the {corpusSize} notes in the{" "}
                  {pack.label.toLowerCase()} corpus. The notes were written for each
                  discipline; they are not extracts from textbooks or published papers.
                </p>
                <p>
                  A note is eligible at a similarity score of {retrieval.minScore.toFixed(2)} or
                  above. At most {retrieval.budget} go to the model, no more than one of them
                  a case-design note. A score below {retrieval.weakScore.toFixed(2)} is marked
                  as a weak match.
                </p>
                <p>The text that was embedded:</p>
                <pre className={cn(QUOTE, "overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed")}>
                  {retrieval.queryText}
                </pre>
              </div>
            </details>
            <details className="text-sm">
              <summary className="w-fit cursor-pointer rounded-sm font-medium text-primary">
                How the readings are computed
              </summary>
              <div className="mt-2 max-w-prose space-y-2 leading-relaxed text-muted-foreground">
                <p>
                  The readings on this step match words, not meaning. A note that covers a
                  concept in other words reads as not mentioning it, and a reflected
                  reading does not show that the {text} used the note correctly.
                </p>
                <p>
                  A note mentions a must-cover concept by name when the must-cover check
                  finds it there: the concept&apos;s words appear inside one sentence of
                  the note&apos;s title, text or tags, in order or close together, after
                  spelling variants, plurals and simple stems are normalised. A concept
                  written as a tension (X vs Y) is split, and each half has to be found.
                  The note also mentions it when the note&apos;s title, or one of its tags
                  of two or more words, is found the same way in the concept, so a note
                  tagged &ldquo;strengths-based&rdquo; names &ldquo;strengths-based
                  assessment&rdquo;.
                </p>
                <p>
                  A note is reflected in the {text} when one of its distinctive tags appears
                  in the scenario, the discussion questions, the model answers or the
                  rubric. A tag is distinctive when at most two notes of this corpus carry
                  it and it is a term of two or more words, an acronym, or a single word
                  only one note uses. A match on any other tag is listed as generic and a
                  match on a tag the brief supplied is listed as in the brief; neither is
                  counted, {`since the ${text} would carry the brief's words whether or not the note was used.`} A note left with no tag that could count is not
                  countable, and the figure is over the countable notes.
                </p>
              </div>
            </details>
            </div>
          </div>
        ) : retrieval.status === "embedding-failed" ? (
          <p className="mx-4 mb-4 mt-2 rounded-md border border-flag/30 bg-flag/5 px-3 py-2 text-sm text-flag sm:mx-5 sm:mb-5">
            The corpus is embedded, but the call that embeds this brief failed, so
            nothing could be scored. Check{" "}
            <code className="font-mono">OPENAI_API_KEY</code> and the network, then
            reload this step. Running{" "}
            <code className="font-mono">pnpm embed-corpus</code> will not help.
            {retrieval.error ? (
              <>
                {" "}
                The provider reported:{" "}
                <span className="font-mono">{retrieval.error}</span>
              </>
            ) : null}
          </p>
        ) : (
          <p className="mx-4 mb-4 mt-2 rounded-md border bg-muted/60 px-3 py-2 text-sm text-muted-foreground sm:mx-5 sm:mb-5">
            The corpus has not been embedded yet, so there are no vectors to score
            against. Run <code className="font-mono">pnpm embed-corpus</code> (needs{" "}
            <code className="font-mono">OPENAI_API_KEY</code>). Until then, generation uses
            the discipline prompt and exemplars without retrieved notes.
          </p>
        )}
      </section>

      <details className={cn(CARD, "px-4 py-4 sm:px-5")}>
        <summary className="cursor-pointer rounded-sm text-base font-semibold">
          What else the model is given{" "}
          <span className="font-normal text-muted-foreground">
            (discipline prompt, style notes, vocabulary, difficulty instruction, exemplars)
          </span>
        </summary>
        <div className="mt-4 space-y-4">
      <section className="border-t pt-4">
        <h3 className={H3}>Discipline system prompt</h3>
        <pre className={cn(QUOTE, "mt-3 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed")}>
          {pack.systemPrompt}
        </pre>
      </section>

      <section className="border-t pt-4">
        <h3 className={H3}>Style notes</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {pack.styleNotes.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="border-t pt-4">
        <h3 className={H3}>Discipline vocabulary</h3>
        <p className="mt-2 text-sm text-muted-foreground">{pack.vocabulary.join(", ")}</p>
      </section>

      <section className="border-t pt-4">
        <h3 className={H3}>
          Difficulty instruction ({difficulty})
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {pack.difficultyHints[difficulty]}
        </p>
      </section>

      <section className="border-t pt-4">
        <h3 className={H3}>Reference exemplars ({pack.fewShots.length})</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Given to the model for style and depth. It is told not to reuse their content.
        </p>
        <div className="mt-3 space-y-3">
          {pack.fewShots.map((ex, i) => (
            <details key={i} className="border-t pt-3">
              <summary className="cursor-pointer rounded-sm text-sm font-medium">
                <span className="mr-2 text-muted-foreground">Exemplar {i + 1}:</span>
                {ex.title}
              </summary>
              <div className="mt-2 max-w-prose space-y-3 text-sm leading-relaxed text-muted-foreground">
                <div>
                  <strong className="text-foreground">Scenario.</strong> {ex.scenario}
                </div>
                <div>
                  <strong className="text-foreground">Discussion questions.</strong>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                    {ex.discussionQuestions.map((q, j) => (
                      <li key={j}>{q}</li>
                    ))}
                  </ol>
                </div>
                <div>
                  <strong className="text-foreground">Rubric.</strong> {ex.rubric}
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

        </div>
      </details>

    </div>
  );
}
