// The time limits of the instructor's "Generate case" request
// (lib/generation/generate-attempts.ts). Small limits stand in for the real
// ones so that each test runs in milliseconds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GENERATE_ATTEMPT_TIMEOUT_MS,
  GENERATE_BUDGET_MS,
  GENERATE_MIN_RETRY_MS,
  runGenerationAttempts,
  type Validation,
} from "@/lib/generation/generate-attempts";

const accept = (v: string): Validation<string> => ({ ok: true, value: v });
const rejectThin = (v: string): Validation<string> =>
  v === "thin"
    ? { ok: false, failure: { reason: "schema_validation", detail: ["scenario: too short"] } }
    : { ok: true, value: v };

// A call that never answers until it is aborted, like a stalled model call.
function stalled(signal: AbortSignal): Promise<string> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("This operation was aborted")));
  });
}

const SMALL = { budgetMs: 400, attemptTimeoutMs: 120, minRetryMs: 100 };

test("a first attempt that passes is kept and nothing else runs", async () => {
  let calls = 0;
  const run = await runGenerationAttempts(async () => {
    calls++;
    return "draft";
  }, accept, SMALL);
  assert.equal(run.value, "draft");
  assert.equal(calls, 1);
  assert.equal(run.attempts.length, 1);
  assert.equal(run.attempts[0].outcome, "ok");
  assert.equal(run.timedOut, false);
});

test("a draft that fails the editor's checks is retried once", async () => {
  const replies = ["thin", "full"];
  const run = await runGenerationAttempts(async () => replies.shift()!, rejectThin, SMALL);
  assert.equal(run.value, "full");
  assert.deepEqual(run.attempts.map((a) => a.outcome), ["schema_validation", "ok"]);
});

test("two failed checks end with the schema failure and no value", async () => {
  const run = await runGenerationAttempts(async () => "thin", rejectThin, SMALL);
  assert.equal(run.value, null);
  assert.equal(run.lastFailure?.reason, "schema_validation");
  assert.equal(run.attempts.length, 2);
  assert.equal(run.timedOut, false);
});

test("a stalled first call is aborted at its timeout and the retry answers", async () => {
  const signals: AbortSignal[] = [];
  let n = 0;
  const started = Date.now();
  const run = await runGenerationAttempts(
    (signal) => {
      signals.push(signal);
      return ++n === 1 ? stalled(signal) : Promise.resolve("draft");
    },
    accept,
    SMALL,
  );
  assert.equal(run.value, "draft");
  assert.deepEqual(run.attempts.map((a) => a.outcome), ["timeout", "ok"]);
  assert.equal(signals[0].aborted, true, "the stalled call was told to stop");
  assert.ok(Date.now() - started < SMALL.budgetMs, "finished inside the budget");
});

test("a stalled call that ignores the signal is still given up on", async () => {
  const run = await runGenerationAttempts(
    () => new Promise<string>(() => {}),
    accept,
    { ...SMALL, attempts: 1 },
  );
  assert.equal(run.value, null);
  assert.equal(run.lastFailure?.reason, "timeout");
  assert.match(run.lastFailure!.detail[0], /timed out/);
  assert.equal(run.timedOut, true);
});

test("no second attempt starts when too little of the budget is left", async () => {
  let calls = 0;
  const run = await runGenerationAttempts(
    (signal) => {
      calls++;
      return stalled(signal);
    },
    accept,
    { budgetMs: 200, attemptTimeoutMs: 150, minRetryMs: 100 },
  );
  assert.equal(calls, 1);
  assert.equal(run.value, null);
  assert.equal(run.timedOut, true);
});

test("the second attempt is cut to what is left of the budget", async () => {
  let n = 0;
  const started = Date.now();
  const run = await runGenerationAttempts(
    (signal) => {
      n++;
      return stalled(signal);
    },
    accept,
    { budgetMs: 300, attemptTimeoutMs: 180, minRetryMs: 50 },
  );
  const took = Date.now() - started;
  assert.equal(n, 2);
  assert.equal(run.value, null);
  assert.ok(took < 300 + 60, `both attempts ended near the budget (${took} ms)`);
});

test("a provider error is retried and reported as a model error", async () => {
  let n = 0;
  const run = await runGenerationAttempts(async () => {
    n++;
    throw new Error("rate limited");
  }, accept, SMALL);
  assert.equal(n, 2);
  assert.equal(run.lastFailure?.reason, "model_error");
  assert.deepEqual(run.lastFailure?.detail, ["rate limited"]);
  assert.equal(run.timedOut, false);
});

test("the budget ends inside the route's maxDuration in vercel.json", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    functions: Record<string, { maxDuration: number }>;
  };
  const maxDuration = config.functions["app/api/admin/cases/[id]/generate/route.ts"].maxDuration;
  // At least 15 s are left for sign-in, the database reads and writes and a
  // cold start.
  assert.ok(GENERATE_BUDGET_MS + 15_000 <= maxDuration * 1000);
  // A normal attempt (10 to 25 s) fits in the time left for the retry.
  assert.ok(GENERATE_MIN_RETRY_MS >= 25_000);
  assert.ok(GENERATE_ATTEMPT_TIMEOUT_MS + GENERATE_MIN_RETRY_MS <= GENERATE_BUDGET_MS);
  // The Hobby plan with fluid compute allows up to 300 s.
  assert.ok(maxDuration <= 300);
});
