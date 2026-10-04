import { NextResponse } from "next/server";

// The hosted instance runs on one shared instructor sign-in, so every visitor
// who signs in sees the same seeded example cases. The routes that edit,
// approve, release or delete a case therefore refuse them. Rows seeded by
// scripts/seed-demo.ts all carry the "seed-" id prefix, which is what this
// guard reads.
//
// Read-only means read-only for the routes that change a case, and for the two
// baselines of the contrastive view, from which the committed readings in
// demo/comparison-readings.json are taken.
// Duplicating is allowed: the copy is an ordinary case the visitor owns and can
// do anything with, re-running its baselines included.
export const SEEDED_CASE_PREFIX = "seed-";

export function isSeededCase(caseId: string): boolean {
  return caseId.startsWith(SEEDED_CASE_PREFIX);
}

export const SEEDED_READ_ONLY_MESSAGE =
  "This is a seeded example case and is read-only on the public demo. Use Duplicate to get your own copy to edit.";

// Why the contrastive view's baselines cannot be re-run here. Shown by the API
// and printed beside the disabled control, so the two say the same thing.
export const SEEDED_BASELINES_MESSAGE =
  "Seeded examples keep fixed baselines so that the published readings stay reproducible. Duplicate the case to re-run them.";

// The title on a control that is disabled because the case is a seeded example.
export const SEEDED_DISABLED_TITLE =
  "Seeded example cases are read-only. Duplicate one to get a copy you can change.";

// Returns a 403 to be sent back, or null when the case may be changed.
export function seededCaseGuard(caseId: string): NextResponse | null {
  if (!isSeededCase(caseId)) return null;
  return NextResponse.json(
    { error: "seeded_case_read_only", message: SEEDED_READ_ONLY_MESSAGE },
    { status: 403 },
  );
}
