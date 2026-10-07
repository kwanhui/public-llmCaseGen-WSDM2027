import { NextResponse } from "next/server";

// The hosted instance runs on one shared instructor sign-in, so every visitor
// who signs in sees the same seeded example cases. The routes that edit,
// approve, release or delete a case therefore refuse them. Rows seeded by
// scripts/seed-demo.ts all carry the "seed-" id prefix, which isSeededCase
// reads; the six walkthrough cases are listed by id below and are refused in
// the same way.
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

// The six walkthrough cases on the hosted instance (demo/walkthrough/briefs.json),
// from which demo/walkthrough/case-study.csv is read. They were created through
// the interface, so they carry ordinary ids rather than the "seed-" prefix, and
// are listed here so that the same routes refuse to change them.
export const WALKTHROUGH_CASE_IDS: ReadonlySet<string> = new Set([
  "35ad953b-0a4d-4234-a712-79ad66036579", // Finance: expansion
  "e228508d-6ed0-4c45-bf74-fbab54445a54", // Finance: liquidity
  "b139d163-34e2-445b-8436-fb9810150ef6", // Marketing: positioning
  "173ab236-71eb-411a-b77a-bf6d42d50084", // Marketing: churn
  "4f9ed40b-ae5c-43fd-8737-6f6f0394bb99", // Social work: discharge
  "d78e756e-f5b2-4997-98b6-ccef07a8ec71", // Social work: school refusal
]);

// True for a case that the routes which change a case refuse: a seeded example
// case or one of the walkthrough cases. isSeededCase stays the narrower test
// for what concerns the seeded rows alone (their committed baselines, the
// student page's wording, the public demo's student scene).
export function isReadOnlyCase(caseId: string): boolean {
  return isSeededCase(caseId) || WALKTHROUGH_CASE_IDS.has(caseId);
}

export const SEEDED_READ_ONLY_MESSAGE =
  "This is an example case and is read-only on the public demo. Use Duplicate to get your own copy to edit.";

// Why the contrastive view's baselines cannot be re-run here. Shown by the API
// and printed beside the disabled control, so the two say the same thing.
export const SEEDED_BASELINES_MESSAGE =
  "Seeded examples keep fixed baselines so that the published readings stay reproducible. Duplicate the case to re-run them.";

// The title on a control that is disabled because the case is read-only.
export const SEEDED_DISABLED_TITLE =
  "Example cases are read-only. Duplicate one to get a copy you can change.";

// Returns a 403 to be sent back, or null when the case may be changed. It
// refuses the seeded cases and the walkthrough cases alike.
export function seededCaseGuard(caseId: string): NextResponse | null {
  if (!isReadOnlyCase(caseId)) return null;
  return NextResponse.json(
    { error: "seeded_case_read_only", message: SEEDED_READ_ONLY_MESSAGE },
    { status: 403 },
  );
}
