// Rate limits and output caps on the routes outside the public demo that call
// the model: the student routes under app/api/case/[token] and the instructor
// routes under app/api/admin/cases/[id] (lib/ratelimit.ts scopes "case" and
// "admin", lib/llm/route-limits.ts).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { enforceRateLimit, resetRateLimit } from "@/lib/ratelimit";
import { ROUTE_COST, ROUTE_MAX_OUTPUT_TOKENS } from "@/lib/llm/route-limits";
import { DEMO_MAX_OUTPUT_TOKENS } from "@/lib/demo/guards";

const ENV = [
  "DEMO_UNITS_PER_CLIENT_PER_10MIN",
  "DEMO_UNITS_GLOBAL_PER_HOUR",
  "CASE_UNITS_PER_CLIENT_PER_10MIN",
  "CASE_UNITS_GLOBAL_PER_HOUR",
  "ADMIN_UNITS_PER_CLIENT_PER_10MIN",
  "ADMIN_UNITS_GLOBAL_PER_HOUR",
];

beforeEach(() => {
  for (const name of ENV) delete process.env[name];
  resetRateLimit();
});

function from(ip: string): Request {
  return new Request("http://localhost/api", { headers: { "x-forwarded-for": ip } });
}

// Charges `cost` until the first refusal; returns how many requests passed.
function passes(scope: "demo" | "case" | "admin", ip: string, cost: number, extra = ""): number {
  let n = 0;
  while (n < 1000 && enforceRateLimit(from(ip), cost, scope, extra) === null) n++;
  return n;
}

test("the default per-client budgets of the three scopes", () => {
  assert.equal(passes("demo", "10.0.0.1", 1), 24);
  assert.equal(passes("case", "10.0.0.1", ROUTE_COST.hint, "link-a"), 30);
  assert.equal(passes("admin", "10.0.0.1", ROUTE_COST.generate), 40);
});

test("each scope keeps its own counters", () => {
  assert.equal(passes("demo", "10.0.0.2", 1), 24);
  assert.equal(enforceRateLimit(from("10.0.0.2"), 1, "case", "link-a"), null);
  assert.equal(enforceRateLimit(from("10.0.0.2"), 1, "admin"), null);
});

test("a refusal is a 429 with a message and a retry time", async () => {
  process.env.ADMIN_UNITS_PER_CLIENT_PER_10MIN = "4";
  assert.equal(enforceRateLimit(from("10.0.0.3"), ROUTE_COST.compare, "admin"), null);
  const refused = enforceRateLimit(from("10.0.0.3"), ROUTE_COST.generate, "admin");
  assert.ok(refused);
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  const body = (await refused.json()) as { error: string; message: string };
  assert.equal(body.error, "rate_limited");
  assert.match(body.message, /Nothing was changed/);
});

test("on the student routes a client is one address on one team link", () => {
  process.env.CASE_UNITS_PER_CLIENT_PER_10MIN = "3";
  assert.equal(passes("case", "10.0.0.4", 1, "link-a"), 3);
  assert.equal(passes("case", "10.0.0.4", 1, "link-b"), 3);
  assert.equal(passes("case", "10.0.0.5", 1, "link-a"), 3);
});

test("the hourly budget is shared by all clients of a scope and refunded on a per-client refusal", () => {
  process.env.CASE_UNITS_GLOBAL_PER_HOUR = "5";
  process.env.CASE_UNITS_PER_CLIENT_PER_10MIN = "2";
  assert.equal(passes("case", "10.0.0.6", 1, "x"), 2);
  assert.equal(passes("case", "10.0.0.7", 1, "x"), 2);
  assert.equal(passes("case", "10.0.0.8", 1, "x"), 1);
  assert.equal(passes("case", "10.0.0.9", 1, "x"), 0);
});

test("a full request for 20 team variants fits the default instructor budget once", () => {
  assert.equal(enforceRateLimit(from("10.0.0.10"), ROUTE_COST.variant * 20, "admin"), null);
  assert.equal(enforceRateLimit(from("10.0.0.10"), ROUTE_COST.variant * 20, "admin"), null);
  assert.ok(enforceRateLimit(from("10.0.0.10"), ROUTE_COST.variant, "admin"));
});

test("0 switches a scope's checks off", () => {
  process.env.ADMIN_UNITS_PER_CLIENT_PER_10MIN = "0";
  process.env.ADMIN_UNITS_GLOBAL_PER_HOUR = "0";
  assert.equal(passes("admin", "10.0.0.11", 40), 1000);
});

test("the output caps follow the public demo's", () => {
  assert.equal(ROUTE_MAX_OUTPUT_TOKENS.draft, DEMO_MAX_OUTPUT_TOKENS.generate);
  assert.equal(ROUTE_MAX_OUTPUT_TOKENS.variant, DEMO_MAX_OUTPUT_TOKENS.personalise);
  assert.equal(ROUTE_MAX_OUTPUT_TOKENS.hint, DEMO_MAX_OUTPUT_TOKENS.student);
});

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const MODEL_CALLS =
  /\b(generateCase|regenerateSection|personaliseCaseContent|generatePlainCase|generateStructuredNoRetrieval|assessAttempt|generateHint)\b/;

test("every student and instructor route that calls the model is rate limited and capped", () => {
  const scoped: [string, string][] = [
    ["app/api/case", "case"],
    ["app/api/admin", "admin"],
  ];
  let found = 0;
  for (const [dir, scope] of scoped) {
    for (const f of routeFiles(dir)) {
      const source = readFileSync(f, "utf8");
      if (!MODEL_CALLS.test(source.replace(/^import[\s\S]*?;$/gm, ""))) continue;
      found++;
      assert.match(source, new RegExp(`enforceRateLimit\\([^)]*"${scope}"`), `${f} is not rate limited`);
      assert.match(source, /maxTokens(:|,| })/, `${f} sets no output cap`);
    }
  }
  assert.equal(found, 7, `found ${found} model-calling routes outside the demo`);
});

test("the hint route checks the limit of three hints against its own record", () => {
  const source = readFileSync("app/api/case/[token]/hint/route.ts", "utf8");
  assert.match(source, /hintsGiven\(/);
  assert.match(source, /"hint_requested"/);
  assert.match(source, /viewerHash/);
});
