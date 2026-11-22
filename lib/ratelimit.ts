// Spend guard for the public demo endpoints (/api/demo/*) and, in scopes of
// their own, for the student and instructor routes that call the model (see
// below).
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
//
// The same limiter also guards the other routes that call the model, in two
// further scopes with their own counters, so that one kind of traffic cannot
// use up another's allowance: "case", the student routes under
// /api/case/[token] (hint and feedback), where a client is one address on one
// team link; and "admin", the instructor routes under /api/admin/cases/[id]
// that call the model, where a client is one address. Their units are in
// lib/llm/route-limits.ts.
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

const CLIENT_WINDOW_MS = 10 * 60_000;
const GLOBAL_WINDOW_MS = 60 * 60_000;

export type RateLimitScope = "demo" | "case" | "admin";

interface ScopeConfig {
  perClientEnv: string;
  perClientDefault: number;
  globalEnv: string;
  globalDefault: number;
  busyMessage: string;
  clientMessage: string;
}

// The demo defaults allow a visitor two full scripted runs of the demo in ten
// minutes. The "case" defaults allow a team working on one link several hints
// and feedback readings per phase. The "admin" defaults allow one full set of
// 20 team variants (40 units) in ten minutes, which the variants route needs
// in one request.
const SCOPES: Record<RateLimitScope, ScopeConfig> = {
  demo: {
    perClientEnv: "DEMO_UNITS_PER_CLIENT_PER_10MIN",
    perClientDefault: 24,
    globalEnv: "DEMO_UNITS_GLOBAL_PER_HOUR",
    globalDefault: 240,
    busyMessage: "The public demo is busy. Try again later.",
    clientMessage:
      "You have used this demo's allowance for the moment. Try again in a few minutes.",
  },
  case: {
    perClientEnv: "CASE_UNITS_PER_CLIENT_PER_10MIN",
    perClientDefault: 30,
    globalEnv: "CASE_UNITS_GLOBAL_PER_HOUR",
    globalDefault: 600,
    busyMessage: "Hints and feedback are busy at the moment. Please try again later.",
    clientMessage:
      "You have asked for many hints and feedback readings in a short time. Please try again in a few minutes.",
  },
  admin: {
    perClientEnv: "ADMIN_UNITS_PER_CLIENT_PER_10MIN",
    perClientDefault: 80,
    globalEnv: "ADMIN_UNITS_GLOBAL_PER_HOUR",
    globalDefault: 400,
    busyMessage:
      "The model routes have reached their limit for this hour. Nothing was changed. Try again later.",
    clientMessage:
      "You have reached the limit on model calls for the moment. Nothing was changed. Try again in a few minutes.",
  },
};

// 0 disables a check, which is what local development and the screencast
// recorder want.
function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Read on every call rather than at module load, so a test (or a redeploy with
// new env values) sees the current setting.
function perClientLimit(scope: RateLimitScope = "demo"): number {
  const c = SCOPES[scope];
  return num(process.env[c.perClientEnv], c.perClientDefault);
}
function globalLimit(scope: RateLimitScope = "demo"): number {
  const c = SCOPES[scope];
  return num(process.env[c.globalEnv], c.globalDefault);
}

interface Bucket {
  spent: number;
  resetAt: number;
}

interface ScopeState {
  clients: Map<string, Bucket>;
  global: Bucket;
}

function freshState(): Record<RateLimitScope, ScopeState> {
  return {
    demo: { clients: new Map(), global: { spent: 0, resetAt: 0 } },
    case: { clients: new Map(), global: { spent: 0, resetAt: 0 } },
    admin: { clients: new Map(), global: { spent: 0, resetAt: 0 } },
  };
}

let state = freshState();

// Per process, so a key cannot be correlated across deployments or rebuilt
// from an IP by anyone reading this code.
const SALT = randomBytes(16).toString("hex");

// `extra` narrows the client further, such as the team link of a student
// route, so that one address on one link cannot use up the allowance of the
// same address on another link.
function clientKey(req: Request, extra = ""): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256")
    .update(SALT)
    .update(ip)
    .update("\0")
    .update(extra)
    .digest("hex")
    .slice(0, 16);
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
function evictExpired(clients: Map<string, Bucket>, now: number): void {
  if (clients.size < 5_000) return;
  for (const [key, bucket] of clients) {
    if (now >= bucket.resetAt) clients.delete(key);
  }
}

/**
 * Charges `cost` units against the per-client and per-instance budgets of
 * `scope` (the public demo's when no scope is given). Returns a 429 response
 * when either is exhausted, or null to proceed. `clientExtra` narrows the
 * client beyond its address (see clientKey).
 */
export function enforceRateLimit(
  req: Request,
  cost: number,
  scope: RateLimitScope = "demo",
  clientExtra = "",
): NextResponse | null {
  const perClient = perClientLimit(scope);
  const global = globalLimit(scope);
  if (perClient === 0 && global === 0) return null;
  if (cost <= 0) return null;
  const now = Date.now();
  const { clients, global: globalBucket } = state[scope];
  const messages = SCOPES[scope];
  evictExpired(clients, now);

  if (global > 0 && !take(globalBucket, cost, global, GLOBAL_WINDOW_MS, now)) {
    return tooMany(globalBucket, now, messages.busyMessage);
  }
  if (perClient > 0) {
    const key = clientKey(req, clientExtra);
    const bucket = clients.get(key) ?? { spent: 0, resetAt: 0 };
    clients.set(key, bucket);
    if (!take(bucket, cost, perClient, CLIENT_WINDOW_MS, now)) {
      // Refund the global charge: this request never reaches the model, so
      // holding it against the shared budget would penalise everyone else.
      if (global > 0) globalBucket.spent = Math.max(0, globalBucket.spent - cost);
      return tooMany(bucket, now, messages.clientMessage);
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
  const { clients, global: globalBucket } = state.demo;
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

/** Test seam: drops all counters, in every scope. */
export function resetRateLimit(): void {
  state = freshState();
}
