// Retries for a demo model call that returns structured output. A structured-
// output failure (the model returns JSON the schema rejects, or the JSON is cut
// off) is usually transient, so the demo retries it: once by default, as the
// instructor's generate route does, and twice for the PersCase draft and the
// regeneration of one of its sections (DEMO_DRAFT_ATTEMPTS), the two calls a
// guided run cannot go on without. The request guard has already charged the
// rate limiter by the time this runs, so a retry is not charged again.
//
// With a deadline, no attempt starts after it, and an attempt still running
// when it passes is no longer waited for: the route's own time limit
// (maxDuration in vercel.json) would otherwise end the request with no reply,
// and the PersCase arm could not fall back to its stored draft.
import { NoObjectGeneratedError } from "ai";
import { NextResponse } from "next/server";

// Attempts for the PersCase draft and for a regenerated section.
export const DEMO_DRAFT_ATTEMPTS = 3;

// How long the retries of one request may take, well inside the route's 60 s.
export const DEMO_RETRY_BUDGET_MS = 50_000;

const RETRIES_IN_WORDS = ["", "the automatic retry", "the two automatic retries"];

// The message names the attempts that were made. `timedOut` adds that the
// time for the step ran out before the attempts were used up.
export function schemaFailureMessage(attempts: number, timedOut = false): string {
  const retries = attempts - 1;
  const when =
    retries <= 0
      ? "on the first attempt"
      : `on the first attempt or on ${RETRIES_IN_WORDS[retries] ?? `the ${retries} automatic retries`}`;
  const time = timedOut ? ", and the time for this step ran out" : "";
  return `The model did not return a draft that fits the case schema, ${when}${time}. Try again.`;
}

export class DemoSchemaError extends Error {
  readonly attempts: number;
  constructor(attempts = 2, timedOut = false) {
    super(schemaFailureMessage(attempts, timedOut));
    this.name = "DemoSchemaError";
    this.attempts = attempts;
  }
}

class DeadlinePassed extends Error {}

// Resolves with the call's result, or rejects with DeadlinePassed when the
// deadline comes first. The call itself cannot be cancelled; its later result
// or error is dropped.
export async function beforeDeadline<T>(pending: Promise<T>, deadline: number | undefined): Promise<T> {
  if (deadline === undefined) return pending;
  const left = deadline - Date.now();
  if (left <= 0) {
    pending.catch(() => {});
    throw new DeadlinePassed();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlinePassed()), left);
  });
  pending.catch(() => {});
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function isDeadlinePassed(err: unknown): boolean {
  return err instanceof DeadlinePassed;
}

export async function withSchemaRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; deadline?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 2);
  for (let attempt = 1; ; attempt++) {
    try {
      return await beforeDeadline(fn(), opts.deadline);
    } catch (err) {
      if (err instanceof DeadlinePassed) {
        console.warn(`[demo] ${label}: the time for this request ran out (attempt ${attempt} of ${attempts})`);
        throw new DemoSchemaError(attempt, true);
      }
      if (!NoObjectGeneratedError.isInstance(err)) throw err;
      console.warn(
        `[demo] ${label}: output did not match the schema (attempt ${attempt} of ${attempts}; finish reason ${err.finishReason ?? "unknown"}, ${err.text?.length ?? 0} characters)`,
      );
      if (attempt >= attempts) throw new DemoSchemaError(attempts);
      if (opts.deadline !== undefined && Date.now() >= opts.deadline) {
        throw new DemoSchemaError(attempt, true);
      }
    }
  }
}

export function schemaFailed(err: DemoSchemaError): NextResponse {
  return NextResponse.json({ error: "model_failed", message: err.message }, { status: 502 });
}
