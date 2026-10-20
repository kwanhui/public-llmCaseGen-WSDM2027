// Which retrieved notes grounded the draft a case holds.
//
// A generated draft records its retrieval list ("embedding:<model>" and one
// "corpus:<note id> (<score>)" per note) with its generation_completed event.
// A copy made with Duplicate holds the same draft but was never generated, so
// the duplicate route records the source's list with the copy's "created"
// event. The list for the current draft is the one from the latest of those
// events. Copies made before the duplicate route recorded the list carry only
// the source's id; for them the caller looks the list up on the source, as it
// stood when the copy was made (see `loadTeamProvenance`).

export interface ProvenanceEvent {
  eventType: string;
  timestampIso: string;
  metadata: unknown;
}

export interface DraftRetrieval {
  // The retrieval list of the current draft, or null when none is recorded.
  retrieval: string[] | null;
  // For a copy whose list is not recorded: the source case and the time the
  // copy was made, so the list can be read from the source.
  duplicatedFrom: { caseId: string; at: string } | null;
}

function retrievalOf(metadata: unknown): string[] | null {
  const list = (metadata as { retrieval?: unknown } | null)?.retrieval;
  return Array.isArray(list) && list.every((x) => typeof x === "string") ? (list as string[]) : null;
}

export function draftRetrievalFromEvents(events: ProvenanceEvent[]): DraftRetrieval {
  const ordered = [...events].sort((a, b) => a.timestampIso.localeCompare(b.timestampIso));
  let retrieval: string[] | null = null;
  let duplicatedFrom: DraftRetrieval["duplicatedFrom"] = null;
  for (const e of ordered) {
    if (e.eventType === "generation_completed") {
      // A generation replaces the draft, so it replaces the list, even when
      // (for an old event) it recorded none.
      retrieval = retrievalOf(e.metadata);
      duplicatedFrom = null;
    } else if (e.eventType === "created") {
      const source = (e.metadata as { duplicatedFrom?: unknown } | null)?.duplicatedFrom;
      retrieval = retrievalOf(e.metadata);
      duplicatedFrom =
        retrieval === null && typeof source === "string" ? { caseId: source, at: e.timestampIso } : null;
    }
  }
  return { retrieval, duplicatedFrom };
}
