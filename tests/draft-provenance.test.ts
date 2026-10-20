// The retrieval list of the draft a case holds, including a copy made with
// Duplicate (lib/case/draft-provenance.ts), and the "Reflected in the draft"
// reading the Retrieval step computes from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draftRetrievalFromEvents, type ProvenanceEvent } from "@/lib/case/draft-provenance";
import { groundingUtilisation } from "@/lib/retrieval/grounding";
import type { CaseInput } from "@/lib/disciplines/types";
import type { CaseTextFields } from "@/lib/generation/schema";

const sample = JSON.parse(readFileSync("demo/sample-outputs/finance.json", "utf8")) as {
  input: CaseInput;
  provenance: string[];
  output: CaseTextFields;
};
const LIST = sample.provenance;
const OTHER = ["embedding:text-embedding-3-small", "corpus:fin-wacc (0.512)"];

const ev = (eventType: string, timestampIso: string, metadata: unknown = null): ProvenanceEvent => ({
  eventType,
  timestampIso,
  metadata,
});

test("a generated case reads its list from its last completed generation", () => {
  const r = draftRetrievalFromEvents([
    ev("created", "2026-10-20T01:00:00.000Z"),
    ev("generation_completed", "2026-10-20T01:01:00.000Z", { retrieval: OTHER }),
    ev("generation_completed", "2026-10-20T01:05:00.000Z", { retrieval: LIST }),
  ]);
  assert.deepEqual(r, { retrieval: LIST, duplicatedFrom: null });
});

test("a copy reads the list recorded with its created event", () => {
  const r = draftRetrievalFromEvents([
    ev("created", "2026-10-20T02:00:00.000Z", { duplicatedFrom: "src", retrieval: LIST }),
  ]);
  assert.deepEqual(r, { retrieval: LIST, duplicatedFrom: null });
});

test("a copy that was regenerated reads the list of its own generation", () => {
  const r = draftRetrievalFromEvents([
    ev("generation_completed", "2026-10-20T02:10:00.000Z", { retrieval: OTHER }),
    ev("created", "2026-10-20T02:00:00.000Z", { duplicatedFrom: "src", retrieval: LIST }),
  ]);
  assert.deepEqual(r.retrieval, OTHER, "events are read in time order, whatever order they come in");
});

test("a copy made before the list was recorded points back at its source", () => {
  const r = draftRetrievalFromEvents([
    ev("created", "2026-10-19T02:00:00.000Z", { duplicatedFrom: "src" }),
  ]);
  assert.deepEqual(r, { retrieval: null, duplicatedFrom: { caseId: "src", at: "2026-10-19T02:00:00.000Z" } });
});

test("a new case with no draft has no list", () => {
  assert.deepEqual(draftRetrievalFromEvents([ev("created", "2026-10-20T03:00:00.000Z")]), {
    retrieval: null,
    duplicatedFrom: null,
  });
});

test("the copy's Retrieval step marks the same notes reflected as the source's", () => {
  // The source's list comes from its generation, the copy's from its created
  // event; the draft text is the same.
  const source = draftRetrievalFromEvents([
    ev("generation_completed", "2026-10-20T01:00:00.000Z", { retrieval: LIST }),
  ]).retrieval;
  const copy = draftRetrievalFromEvents([
    ev("created", "2026-10-20T02:00:00.000Z", { duplicatedFrom: "src", retrieval: source }),
  ]).retrieval;
  assert.ok(copy, "the copy has a list, so the column does not read 'no draft yet'");
  const a = groundingUtilisation(sample.output, source!, sample.input);
  const b = groundingUtilisation(sample.output, copy, sample.input);
  assert.deepEqual(b, a);
  assert.equal(b.total, 5);
  assert.ok(b.notes.length === 5 && b.notes.every((n) => typeof n.reflected === "boolean"));
});
