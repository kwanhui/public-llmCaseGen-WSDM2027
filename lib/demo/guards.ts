// Guards shared by the public demo routes (/api/demo/*). Every route calls
// guardDemoRequest before it parses anything expensive or reaches a model.
//
// Three checks, in order:
//   1. the kill switch PUBLIC_DEMO ("0" or "false" pauses the demo);
//   2. a daily unit budget across all visitors, DEMO_UNITS_PER_DAY, reset at
//      UTC midnight;
//   3. the per-client and hourly global budgets in lib/ratelimit.ts.
//
// Like the rate limiter, the daily counter is in memory and per instance, so
// the provider's own monthly budget remains the only hard ceiling.
import { NextResponse } from "next/server";
import { enforceRateLimit, resetRateLimit } from "@/lib/ratelimit";
import { DemoSchemaError, schemaFailed } from "@/lib/demo/schema-retry";

// Units each demo request costs; defined with the contracts so that the page
// reads the same numbers (lib/demo/contracts.ts).
export { DEMO_COST } from "@/lib/demo/contracts";

// Output caps passed as `maxTokens` on every demo model call.
export const DEMO_MAX_OUTPUT_TOKENS = { generate: 6000, personalise: 6000, student: 600 } as const;

function envNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function isDemoPaused(): boolean {
  const v = (process.env.PUBLIC_DEMO ?? "").trim().toLowerCase();
  return v === "0" || v === "false";
}

let daily = { day: "", spent: 0 };

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// Charges the daily budget. Returns false, and charges nothing, when the
// request would take the day over the limit.
function takeDaily(cost: number): boolean {
  const limit = envNumber(process.env.DEMO_UNITS_PER_DAY, 1500);
  if (limit === 0 || cost <= 0) return true;
  const today = utcDay(new Date());
  if (daily.day !== today) daily = { day: today, spent: 0 };
  if (daily.spent + cost > limit) return false;
  daily.spent += cost;
  return true;
}

function refundDaily(cost: number): void {
  daily.spent = Math.max(0, daily.spent - cost);
}

/**
 * Returns a JSON error response when the request may not proceed, or null.
 * `cost` is in demo units (see DEMO_COST); 0 skips the budgets but still
 * honours the kill switch.
 */
export async function guardDemoRequest(req: Request, cost: number): Promise<NextResponse | null> {
  if (isDemoPaused()) {
    return NextResponse.json(
      { error: "demo_paused", message: "The public demo is paused." },
      { status: 503 },
    );
  }
  if (!takeDaily(cost)) {
    return NextResponse.json(
      {
        error: "daily_limit",
        message: "The public demo has reached today's limit. Try again tomorrow.",
      },
      { status: 429 },
    );
  }
  const limited = enforceRateLimit(req, cost);
  if (limited) {
    // The request never reaches the model, so it should not count against the
    // day's budget either.
    refundDaily(cost);
    return limited;
  }
  return null;
}

export async function withTiming<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; elapsedMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, elapsedMs: Date.now() - start };
}

// Largest request body the demo routes read. A brief plus a full case and a
// student answer fits well inside it.
export const DEMO_MAX_BODY_BYTES = 64 * 1024;

/**
 * Reads a JSON body with a size cap. Returns the parsed value, or a 413 / 400
 * response to send back.
 */
export async function readDemoJson(
  req: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > DEMO_MAX_BODY_BYTES) {
    return { ok: false, response: tooLarge() };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: invalid([{ message: "Could not read the request body." }]) };
  }
  if (Buffer.byteLength(text, "utf8") > DEMO_MAX_BODY_BYTES) {
    return { ok: false, response: tooLarge() };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: invalid([{ message: "The request body is not valid JSON." }]) };
  }
}

export function invalid(issues: unknown): NextResponse {
  return NextResponse.json({ error: "invalid", issues }, { status: 400 });
}

function tooLarge(): NextResponse {
  return NextResponse.json(
    { error: "too_large", message: `The request body is over ${DEMO_MAX_BODY_BYTES} bytes.` },
    { status: 413 },
  );
}

export function modelFailed(err: unknown): NextResponse {
  if (err instanceof DemoSchemaError) return schemaFailed(err);
  return NextResponse.json(
    {
      error: "model_failed",
      message: err instanceof Error ? err.message : "The model call failed.",
    },
    { status: 502 },
  );
}

/** Test seam: drops the daily counter and the rate-limit buckets. */
export function resetDemoGuards(): void {
  daily = { day: "", spent: 0 };
  resetRateLimit();
}
