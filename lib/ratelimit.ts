// Spend guard for the public demo endpoints (/api/demo/*).
//
// The demo routes are unauthenticated and each one reaches the generation
// model, so an unattended scripted caller is a billing problem long before it
// is a load problem. The limiter therefore budgets *units* weighted by the
// model work a request does (see DEMO_COST in lib/demo/contracts.ts), not raw
// requests, so one budget bounds spend whichever endpoint is hit.
//
// Two deliberate limits on what this can promise:
//
//   1. State is per instance and in memory. Serverless spreads traffic across
//      instances, so a determined caller gets roughly (limit x instances).
//      That is enough to stop casual abuse and accidental loops, and it is
//      not a substitute for a hard ceiling. Set a monthly budget on the
//      provider API key; that is the only guarantee. To make this durable,
//      swap the Map for Upstash Redis and keep the same call sites.
//   2. Nothing is persisted. Client keys are a hash of the forwarded IP with
//      a per-process salt, held in memory and evicted on expiry, so the
//      demo's "nothing a visitor types is stored" promise still holds.
//
// Ported from lib/ratelimit.ts of SAGE
// (https://github.com/kwanhui/public-llmLearnFair-CIKM2026), with a ten-minute
// per-client window and an hourly global window in place of one minute.
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

const CLIENT_WINDOW_MS = 10 * 60_000;
const GLOBAL_WINDOW_MS = 60 * 60_000;

// 0 disables a check, which is what local development and the screencast
// recorder want. Defaults allow a visitor two full scripted runs of the demo
// in ten minutes.
function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Read on every call rather than at module load, so a test (or a redeploy with
// new env values) sees the current setting.
function perClientLimit(): number {
  return num(process.env.DEMO_UNITS_PER_CLIENT_PER_10MIN, 24);
}
function globalLimit(): number {
  return num(process.env.DEMO_UNITS_GLOBAL_PER_HOUR, 240);
}

interface Bucket {
  spent: number;
  resetAt: number;
}

const clients = new Map<string, Bucket>();
let globalBucket: Bucket = { spent: 0, resetAt: 0 };

// Per process, so a key cannot be correlated across deployments or rebuilt
// from an IP by anyone reading this code.
const SALT = randomBytes(16).toString("hex");

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(SALT).update(ip).digest("hex").slice(0, 16);
}

function take(bucket: Bucket, cost: number, limit: number, windowMs: number, now: number): boolean {
  if (now >= bucket.resetAt) {
    bucket.spent = 0;
    bucket.resetAt = now + windowMs;
  }
  if (bucket.spent + cost > limit) return false;
  bucket.spent += cost;
  return true;
}

// Expiry is lazy, so a burst of unique clients would otherwise grow the map
// for the life of the instance.
function evictExpired(now: number): void {
  if (clients.size < 5_000) return;
  for (const [key, bucket] of clients) {
    if (now >= bucket.resetAt) clients.delete(key);
  }
}

/**
 * Charges `cost` units against the per-client and per-instance budgets.
 * Returns a 429 response when either is exhausted, or null to proceed.
 */
export function enforceRateLimit(req: Request, cost: number): NextResponse | null {
  const perClient = perClientLimit();
  const global = globalLimit();
  if (perClient === 0 && global === 0) return null;
  if (cost <= 0) return null;
  const now = Date.now();
  evictExpired(now);

  if (global > 0 && !take(globalBucket, cost, global, GLOBAL_WINDOW_MS, now)) {
    return tooMany(globalBucket, now, "The public demo is busy. Try again later.");
  }
  if (perClient > 0) {
    const key = clientKey(req);
    const bucket = clients.get(key) ?? { spent: 0, resetAt: 0 };
    clients.set(key, bucket);
    if (!take(bucket, cost, perClient, CLIENT_WINDOW_MS, now)) {
      // Refund the global charge: this request never reaches the model, so
      // holding it against the shared budget would penalise everyone else.
      if (global > 0) globalBucket.spent = Math.max(0, globalBucket.spent - cost);
      return tooMany(
        bucket,
        now,
        "You have used this demo's allowance for the moment. Try again in a few minutes.",
      );
    }
  }
  return null;
}

function tooMany(bucket: Bucket, now: number, message: string): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return NextResponse.json(
    { error: "rate_limited", message, retryAfterSec },
    { status: 429, headers: { "retry-after": String(retryAfterSec) } },
  );
}

export interface RateLimitPeek {
  // null when the per-client limit is switched off.
  remaining: number | null;
  perClientLimit: number;
  // Seconds until the budget that binds `remaining` refills; null when
  // nothing is spent in it.
  retryAfterSec: number | null;
}

// Units left in a bucket at `now`, and when it refills, without changing it.
function readBucket(bucket: Bucket | undefined, limit: number, now: number) {
  if (!bucket || now >= bucket.resetAt || bucket.spent <= 0) return { left: limit, resetAt: null };
  return { left: Math.max(0, limit - bucket.spent), resetAt: bucket.resetAt };
}

/**
 * Reads what this client could still spend, charging nothing and creating no
 * bucket. The remaining units are the smaller of the client's own and the
 * instance's hourly ones, since either refuses a request.
 */
export function peekRateLimit(req: Request): RateLimitPeek {
  const perClient = perClientLimit();
  if (perClient === 0) return { remaining: null, perClientLimit: 0, retryAfterSec: null };
  const global = globalLimit();
  const now = Date.now();
  const client = readBucket(clients.get(clientKey(req)), perClient, now);
  let remaining = client.left;
  let resetAt = client.resetAt;
  if (global > 0) {
    const g = readBucket(globalBucket, global, now);
    if (g.left < remaining) {
      remaining = g.left;
      resetAt = g.resetAt;
    }
  }
  const retryAfterSec =
    resetAt === null ? null : Math.max(1, Math.ceil((resetAt - now) / 1000));
  return { remaining, perClientLimit: perClient, retryAfterSec };
}

/** Test seam: drops all counters. */
export function resetRateLimit(): void {
  clients.clear();
  globalBucket = { spent: 0, resetAt: 0 };
}
