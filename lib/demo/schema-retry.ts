// Retries for a demo model call that returns structured output. A structured-
// output failure (the model returns JSON the schema rejects, or the JSON is cut
// off) is usually transient, so the demo retries it: once by default, as the
// instructor's generate route does, and twice for the PersCase draft and the
// regeneration of one of its sections (DEMO_DRAFT_ATTEMPTS), the two calls a
// guided run cannot go on without. The request guard has already charged the
// rate limiter by the time this runs, so a retry is not charged again.
//
// The attempts run under the time limits of the instructor's Generate case
// route (lib/generation/generate-attempts.ts): each attempt is stopped at its
// own timeout, another starts only when enough of the request's budget is left
// for it to finish, and the budget ends inside the route's maxDuration
// (vercel.json). The route therefore always replies, and the PersCase arm can
// fall back to its stored draft, rather than the platform ending the request
// with no reply.
import { NextResponse } from "next/server";
import {
  describeAttempts,
  isSchemaFailure,
  runGenerationAttempts,
  type AttemptLimits,
  type AttemptsResult,
} from "@/lib/generation/generate-attempts";

// Attempts for the PersCase draft and for a regenerated section.
export const DEMO_DRAFT_ATTEMPTS = 3;

const RETRIES_IN_WORDS = ["", "the automatic retry", "the two automatic retries"];

// The message names the attempts that were made. `timedOut` adds that the
// time for the step ran out before the attempts were used up. `noAnswer` says
// that the last attempt got no answer at all before its time limit.
export function schemaFailureMessage(attempts: number, timedOut = false, noAnswer = false): string {
  const retries = attempts - 1;
  const when =
    retries <= 0
      ? "on the first attempt"
      : `on the first attempt or on ${RETRIES_IN_WORDS[retries] ?? `the ${retries} automatic retries`}`;
  if (noAnswer) return `The model did not answer in time, ${when}. Try again.`;
  const time = timedOut ? ", and the time for this step ran out" : "";
  return `The model did not return a draft that fits the case schema, ${when}${time}. Try again.`;
}

export class DemoSchemaError extends Error {
  readonly attempts: number;
  constructor(attempts = 2, timedOut = false, noAnswer = false) {
    super(schemaFailureMessage(attempts, timedOut, noAnswer));
    this.name = "DemoSchemaError";
    this.attempts = attempts;
  }
}

// What a demo route does once the attempts are over: the value, or the error
// the page is shown. A schema failure or running out of time becomes a
// DemoSchemaError (which the PersCase arm answers with its stored draft); any
// other error is thrown as it came.
export function demoAttemptsOutcome<V>(label: string, run: AttemptsResult<V>): V {
  console.info(`[demo] ${label}: ${describeAttempts(run.attempts)}`);
  if (run.value !== null) return run.value;
  if (run.timedOut) {
    throw new DemoSchemaError(run.attempts.length, true, run.lastFailure?.reason === "timeout");
  }
  if (run.lastError !== undefined && !isSchemaFailure(run.lastError)) throw run.lastError;
  throw new DemoSchemaError(run.attempts.length);
}

// Two attempts unless `opts.attempts` says otherwise, under the shared limits;
// the PersCase arm passes as `opts.budgetMs` what is left after retrieval.
export async function withSchemaRetry<T>(
  label: string,
  fn: (abortSignal: AbortSignal) => Promise<T>,
  opts: Omit<AttemptLimits, "retryError"> = {},
): Promise<T> {
  const run = await runGenerationAttempts(
    fn,
    (value: T) => ({ ok: true, value: { value } }),
    { ...opts, attempts: Math.max(1, opts.attempts ?? 2), retryError: isSchemaFailure },
  );
  return demoAttemptsOutcome(label, run).value;
}

export function schemaFailed(err: DemoSchemaError): NextResponse {
  return NextResponse.json({ error: "model_failed", message: err.message }, { status: 502 });
}
