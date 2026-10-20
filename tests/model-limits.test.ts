// The time limits on every route that calls the model, beyond Generate case:
// callModelWithinLimits (lib/generation/generate-attempts.ts), the demo's
// withSchemaRetry (lib/demo/schema-retry.ts), the routes' maxDuration in
// vercel.json, and how the buttons word a failed reply
// (components/model-reply.ts). Small limits stand in for the real ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NoObjectGeneratedError } from "ai";
import {
  GENERATE_BUDGET_MS,
  ModelTimeLimitError,
  callModelWithinLimits,
  isSchemaFailure,
  retryAfterTimeoutOnly,
  runGenerationAttempts,
} from "@/lib/generation/generate-attempts";
import { DemoSchemaError, withSchemaRetry } from "@/lib/demo/schema-retry";
import {
  failureMessage,
  noAnswerMessage,
  readModelReply,
} from "@/components/model-reply";

const SMALL = { budgetMs: 400, attemptTimeoutMs: 120, minRetryMs: 100 };

function stalled(signal: AbortSignal): Promise<string> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("This operation was aborted")));
  });
}

function schemaError(): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    text: "{",
    response: { id: "r", timestamp: new Date(0), modelId: "test" },
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finishReason: "length",
  });
}

test("callModelWithinLimits returns the call's result, null included", async () => {
  assert.equal(await callModelWithinLimits("t", async () => "hint", SMALL), "hint");
  assert.equal(await callModelWithinLimits("t", async () => null, SMALL), null);
});

test("a call that stalls twice ends in ModelTimeLimitError with a plain message", async () => {
  let calls = 0;
  await assert.rejects(
    callModelWithinLimits(
      "t",
      (signal) => {
        calls++;
        return stalled(signal);
      },
      { ...SMALL, retryError: retryAfterTimeoutOnly },
    ),
    (err: unknown) => {
      assert.ok(err instanceof ModelTimeLimitError);
      assert.match(err.message, /did not answer in time/);
      assert.doesNotMatch(err.message, /HTTP|\b50[234]\b/);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("retryAfterTimeoutOnly: a stalled call is retried, a provider error is not", async () => {
  let calls = 0;
  const value = await callModelWithinLimits(
    "t",
    (signal, n) => {
      calls++;
      return n === 1 ? stalled(signal) : Promise.resolve("second");
    },
    { ...SMALL, retryError: retryAfterTimeoutOnly },
  );
  assert.equal(value, "second");
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(
    callModelWithinLimits(
      "t",
      async () => {
        calls++;
        throw new Error("rate limited");
      },
      { ...SMALL, retryError: retryAfterTimeoutOnly },
    ),
    /rate limited/,
  );
  assert.equal(calls, 1);
});

test("isSchemaFailure: a schema failure is retried, another error is thrown as it came", async () => {
  assert.equal(isSchemaFailure(schemaError()), true);
  assert.equal(isSchemaFailure(new Error("x")), false);
  let calls = 0;
  const value = await callModelWithinLimits(
    "t",
    async (_signal, n) => {
      calls++;
      if (n === 1) throw schemaError();
      return "feedback";
    },
    { ...SMALL, retryError: isSchemaFailure },
  );
  assert.equal(value, "feedback");
  assert.equal(calls, 2);
});

test("the attempt number and the last thrown error reach the caller", async () => {
  const seen: number[] = [];
  const boom = new Error("boom");
  const run = await runGenerationAttempts(
    async (_signal, n) => {
      seen.push(n);
      throw boom;
    },
    (v: string) => ({ ok: true, value: v }),
    SMALL,
  );
  assert.deepEqual(seen, [1, 2]);
  assert.equal(run.lastError, boom);
  assert.equal(run.lastFailure?.reason, "model_error");
});

test("demo withSchemaRetry: a stall becomes DemoSchemaError saying the model did not answer in time", async () => {
  await assert.rejects(
    withSchemaRetry("t", (signal) => stalled(signal), { ...SMALL, attempts: 3 }),
    (err: unknown) => {
      assert.ok(err instanceof DemoSchemaError);
      assert.match(err.message, /did not answer in time/);
      return true;
    },
  );
});

test("demo withSchemaRetry: schema failures use the attempts, then report the schema", async () => {
  let calls = 0;
  await assert.rejects(
    withSchemaRetry(
      "t",
      async () => {
        calls++;
        throw schemaError();
      },
      { ...SMALL, attempts: 3 },
    ),
    (err: unknown) => {
      assert.ok(err instanceof DemoSchemaError);
      assert.equal(err.attempts, 3);
      assert.match(err.message, /fits the case schema/);
      return true;
    },
  );
  assert.equal(calls, 3);
  await assert.rejects(
    withSchemaRetry("t", async () => {
      throw new Error("provider down");
    }, SMALL),
    /provider down/,
  );
});

// Every route file that imports one of the model-calling library functions.
const MODEL_CALLS =
  /\b(generateCase|regenerateSection|personaliseCaseContent|generatePlainCase|generateStructuredNoRetrieval|assessAttempt|generateHint|plainPersonalise|plainPersonaliseText|plainStudentReply|retrieveForDemo)\b/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

test("every route that calls the model has a maxDuration that holds the whole budget", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    functions: Record<string, { maxDuration: number }>;
  };
  const calling = routeFiles("app/api")
    .filter((f) => MODEL_CALLS.test(readFileSync(f, "utf8").replace(/^import[\s\S]*?;$/gm, "")))
    .map((f) => f.split(path.sep).join("/"));
  assert.ok(calling.length >= 10, `found ${calling.length} model-calling routes`);
  for (const f of calling) {
    const entry = config.functions[f];
    assert.ok(entry, `${f} has no maxDuration in vercel.json`);
    assert.ok(GENERATE_BUDGET_MS + 15_000 <= entry.maxDuration * 1000, `${f}: ${entry.maxDuration} s`);
    assert.ok(entry.maxDuration <= 300, `${f}: above the Hobby plan's limit`);
    const source = readFileSync(f, "utf8");
    assert.match(
      source,
      /callModelWithinLimits|runGenerationAttempts|withSchemaRetry/,
      `${f} calls the model outside the time limits`,
    );
  }
});

test("a failed reply is worded without an HTTP status", () => {
  for (const status of [null, 400, 409, 500, 502, 503, 504]) {
    const message = noAnswerMessage(status, "This section is unchanged.");
    assert.doesNotMatch(message, /HTTP|\b\d{3}\b/);
    assert.match(message, /This section is unchanged\./);
  }
  assert.match(noAnswerMessage(504, "x"), /did not answer in time/);
  assert.match(noAnswerMessage(null, "x"), /connection to the server was lost/);
});

test("the route's own message is preferred over the generic one", () => {
  const reply = readModelReply(502, { error: "generation_failed", message: "The model did not answer in time." });
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(failureMessage(reply, "x"), "The model did not answer in time.");
  const gateway = readModelReply(504, undefined);
  assert.equal(gateway.ok, false);
  if (!gateway.ok) assert.match(failureMessage(gateway, "Nothing was saved."), /did not answer in time\. Nothing was saved\./);
  assert.deepEqual(readModelReply(200, { hint: "h" }), { ok: true, data: { hint: "h" } });
});
