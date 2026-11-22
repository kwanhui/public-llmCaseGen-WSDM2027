// Output caps and rate-limit units for the routes outside the public demo that
// call the model: the student routes under /api/case/[token] and the
// instructor routes under /api/admin/cases/[id]. The units are charged by
// enforceRateLimit (lib/ratelimit.ts) in the "case" and "admin" scopes.
//
// Both follow the public demo's (lib/demo/guards.ts, lib/demo/contracts.ts):
// a full draft, a section or a team variant is one large structured call
// capped at 6,000 output tokens and costs 2 units; a hint is one small call
// capped at 600 and costs 1. A rubric-based assessment returns up to eight
// criteria with a judgment and a next step each, which can run past 600
// tokens, so it is capped at 1,500 and costs 1.
export const ROUTE_MAX_OUTPUT_TOKENS = {
  draft: 6000,
  section: 6000,
  variant: 6000,
  hint: 600,
  assessment: 1500,
} as const;

export const ROUTE_COST = {
  generate: 2,
  regenerate: 2,
  // Per team; a request for several teams costs this many times the count.
  variant: 2,
  // The two baselines of the contrastive view.
  compare: 4,
  assess: 1,
  hint: 1,
  feedback: 1,
} as const;
