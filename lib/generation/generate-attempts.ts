// Time limits for the routes that call the model.
//
// Written first for the instructor's "Generate case" request, which makes up
// to two attempts at the draft, each of which embeds the brief and then asks
// the model for the structured case. A completed generation usually takes 10
// to 25 seconds. When a model call stalls, the platform used to end the
// request at its 60-second limit with a bare HTTP 504: the route could not
// reply, could not put the case back to "draft" and could not log the failure.
// Now every attempt runs under its own timeout, a second attempt starts only
// when enough of the overall budget is left for it to finish, and the budget
// ends well inside the route's maxDuration (120 s in vercel.json), so the route
// always gets to answer.
//
// Every other route that calls the model or the embedding service uses the
// same limits: section regeneration, team variants and their redraft, the
// contrastive baselines, the instructor's assessment, the student's hint and
// feedback, and the three public demo routes. A route whose call either
// returns what it needs or throws uses callModelWithinLimits; a route that
// checks the result before keeping it uses runGenerationAttempts directly.
import { NoObjectGeneratedError } from "ai";

// The whole request: both attempts together, not counting the database writes.
export const GENERATE_BUDGET_MS = 100_000;

// One attempt. A call still running after this long has stalled; the second
// attempt is the better bet.
export const GENERATE_ATTEMPT_TIMEOUT_MS = 55_000;

// A second attempt is started only when at least this much of the budget is
// left, about twice what a normal attempt takes.
export const GENERATE_MIN_RETRY_MS = 30_000;

export const GENERATE_ATTEMPTS = 2;

export interface AttemptFailure {
  // "schema_validation": the draft came back but failed the editor's checks.
  // "model_error": the provider or the network failed.
  // "timeout": the attempt ran out of time.
  // "answer_count_mismatch": a regenerated section no longer pairs one model
  // answer with each discussion question.
  reason: "schema_validation" | "model_error" | "timeout" | "answer_count_mismatch";
  detail: string[];
}

export type Validation<V> = { ok: true; value: V } | { ok: false; failure: AttemptFailure };

export interface AttemptRecord {
  attempt: number;
  ms: number;
  outcome: "ok" | AttemptFailure["reason"];
}

export interface AttemptsResult<V> {
  value: V | null;
  lastFailure: AttemptFailure | null;
  attempts: AttemptRecord[];
  // True when no attempt succeeded and time, not the model, was the last
  // reason: the last attempt timed out, or no time was left for another.
  timedOut: boolean;
  // What the last failed attempt threw, when it threw rather than timed out
  // or failed `validate`. Undefined otherwise.
  lastError: unknown;
}

export interface AttemptLimits {
  attempts?: number;
  budgetMs?: number;
  attemptTimeoutMs?: number;
  minRetryMs?: number;
  now?: () => number;
  // Whether an attempt that threw is followed by another. By default every
  // error is. A route that retried only a schema failure before these limits
  // passes isSchemaFailure, and a route that made a single call passes
  // retryAfterTimeoutOnly. An attempt that timed out, or whose result failed
  // `validate`, is always followed by another while attempts and time remain.
  retryError?: (err: unknown) => boolean;
}

// The model returned output that the schema rejected, or JSON that was cut off.
export function isSchemaFailure(err: unknown): boolean {
  return NoObjectGeneratedError.isInstance(err);
}

// For a route that used to make one call: a second attempt only after a
// timeout, never after an error.
export function retryAfterTimeoutOnly(): boolean {
  return false;
}

class AttemptTimeout extends Error {
  constructor(readonly ms: number) {
    super(`The model call timed out after ${Math.round(ms / 1000)} s`);
    this.name = "AttemptTimeout";
  }
}

// Runs `attempt` until `validate` accepts its result, the attempts are used up
// or the budget runs out. Each attempt receives an AbortSignal that fires at
// its timeout; the attempt is also no longer waited for after that, in case
// the call does not honour the signal.
// `attempt` also receives the attempt's number, counted from 1.
export async function runGenerationAttempts<T, V>(
  attempt: (signal: AbortSignal, attemptNumber: number) => Promise<T>,
  validate: (result: T) => Validation<V>,
  limits: AttemptLimits = {},
): Promise<AttemptsResult<V>> {
  const maxAttempts = Math.max(1, limits.attempts ?? GENERATE_ATTEMPTS);
  const budgetMs = limits.budgetMs ?? GENERATE_BUDGET_MS;
  const attemptTimeoutMs = limits.attemptTimeoutMs ?? GENERATE_ATTEMPT_TIMEOUT_MS;
  const minRetryMs = limits.minRetryMs ?? GENERATE_MIN_RETRY_MS;
  const now = limits.now ?? Date.now;
  const retryError = limits.retryError ?? (() => true);

  const start = now();
  const records: AttemptRecord[] = [];
  let lastFailure: AttemptFailure | null = null;
  let lastError: unknown = undefined;
  let timedOut = false;

  for (let n = 1; n <= maxAttempts; n++) {
    const left = start + budgetMs - now();
    if (n > 1 && left < minRetryMs) {
      timedOut = true;
      break;
    }
    const timeoutMs = Math.max(0, Math.min(attemptTimeoutMs, left));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new AttemptTimeout(timeoutMs);
        controller.abort(err);
        reject(err);
      }, timeoutMs);
    });
    const began = now();
    let failure: AttemptFailure | null = null;
    let thrown: unknown = undefined;
    let value: V | null = null;
    try {
      const pending = attempt(controller.signal, n);
      // A late rejection after the timeout must not surface as unhandled.
      pending.catch(() => {});
      const result = await Promise.race([pending, expired]);
      const checked = validate(result);
      if (checked.ok) value = checked.value;
      else failure = checked.failure;
    } catch (err) {
      if (err instanceof AttemptTimeout || controller.signal.aborted) {
        failure = { reason: "timeout", detail: [new AttemptTimeout(timeoutMs).message] };
      } else {
        failure = { reason: "model_error", detail: [err instanceof Error ? err.message : "Unknown error"] };
        thrown = err;
      }
    } finally {
      clearTimeout(timer);
    }
    records.push({ attempt: n, ms: now() - began, outcome: failure ? failure.reason : "ok" });
    if (!failure) {
      return { value, lastFailure: null, attempts: records, timedOut: false, lastError: undefined };
    }
    lastFailure = failure;
    lastError = thrown;
    timedOut = failure.reason === "timeout";
    if (thrown !== undefined && !retryError(thrown)) break;
  }
  return { value: null, lastFailure, attempts: records, timedOut, lastError };
}

// One line for the server log, e.g. "attempt 1 timeout in 55.0 s, attempt 2 ok in 14.2 s".
export function describeAttempts(attempts: AttemptRecord[]): string {
  return attempts
    .map((a) => `attempt ${a.attempt} ${a.outcome} in ${(a.ms / 1000).toFixed(1)} s`)
    .join(", ");
}

// The seconds each attempt took, to one decimal, for an event's metadata.
export function attemptSeconds(attempts: AttemptRecord[]): number[] {
  return attempts.map((a) => Math.round(a.ms / 100) / 10);
}

// Thrown by callModelWithinLimits when time, not the model, ended the call.
export class ModelTimeLimitError extends Error {
  constructor(readonly attempts: AttemptRecord[]) {
    super(
      attempts.length > 1
        ? "The model did not answer in time, on the first attempt or on the automatic retry."
        : "The model did not answer in time.",
    );
    this.name = "ModelTimeLimitError";
  }
}

// For a model call that either returns what the route needs or throws. Runs
// it under the limits above and returns its result. Throws ModelTimeLimitError
// when the last attempt timed out or no time was left for another, and
// otherwise the error the last attempt threw. `label` names the call in the
// server log.
export async function callModelWithinLimits<T>(
  label: string,
  call: (signal: AbortSignal, attemptNumber: number) => Promise<T>,
  limits: AttemptLimits = {},
): Promise<T> {
  // Wrapped, so that a call whose result is null or false still counts as done.
  const run = await runGenerationAttempts(
    call,
    (value: T): Validation<{ value: T }> => ({ ok: true, value: { value } }),
    limits,
  );
  console.info(`[${label}] ${describeAttempts(run.attempts)}`);
  if (run.value) return run.value.value;
  if (run.timedOut || run.lastError === undefined) throw new ModelTimeLimitError(run.attempts);
  throw run.lastError;
}
