// Time limits for the instructor's "Generate case" request.
//
// The route makes up to two attempts at the draft, each of which embeds the
// brief and then asks the model for the structured case. A completed
// generation usually takes 10 to 25 seconds. When a model call stalls, the
// platform used to end the request at its 60-second limit with a bare HTTP 504:
// the route could not reply, could not put the case back to "draft" and could
// not log the failure. Now every attempt runs under its own timeout, a second
// attempt starts only when enough of the overall budget is left for it to
// finish, and the budget ends well inside the route's maxDuration (120 s in
// vercel.json), so the route always gets to answer.

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
  reason: "schema_validation" | "model_error" | "timeout";
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
}

export interface AttemptLimits {
  attempts?: number;
  budgetMs?: number;
  attemptTimeoutMs?: number;
  minRetryMs?: number;
  now?: () => number;
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
export async function runGenerationAttempts<T, V>(
  attempt: (signal: AbortSignal) => Promise<T>,
  validate: (result: T) => Validation<V>,
  limits: AttemptLimits = {},
): Promise<AttemptsResult<V>> {
  const maxAttempts = Math.max(1, limits.attempts ?? GENERATE_ATTEMPTS);
  const budgetMs = limits.budgetMs ?? GENERATE_BUDGET_MS;
  const attemptTimeoutMs = limits.attemptTimeoutMs ?? GENERATE_ATTEMPT_TIMEOUT_MS;
  const minRetryMs = limits.minRetryMs ?? GENERATE_MIN_RETRY_MS;
  const now = limits.now ?? Date.now;

  const start = now();
  const records: AttemptRecord[] = [];
  let lastFailure: AttemptFailure | null = null;
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
    let value: V | null = null;
    try {
      const pending = attempt(controller.signal);
      // A late rejection after the timeout must not surface as unhandled.
      pending.catch(() => {});
      const result = await Promise.race([pending, expired]);
      const checked = validate(result);
      if (checked.ok) value = checked.value;
      else failure = checked.failure;
    } catch (err) {
      failure =
        err instanceof AttemptTimeout || controller.signal.aborted
          ? { reason: "timeout", detail: [new AttemptTimeout(timeoutMs).message] }
          : { reason: "model_error", detail: [err instanceof Error ? err.message : "Unknown error"] };
    } finally {
      clearTimeout(timer);
    }
    records.push({ attempt: n, ms: now() - began, outcome: failure ? failure.reason : "ok" });
    if (!failure) return { value, lastFailure: null, attempts: records, timedOut: false };
    lastFailure = failure;
    timedOut = failure.reason === "timeout";
  }
  return { value: null, lastFailure, attempts: records, timedOut };
}
