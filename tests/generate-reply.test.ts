// How the "Generate case" button reads the reply of the generate route
// (components/admin/case-wizard/generate-reply.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  noReplyMessage,
  readGenerateReply,
  shouldRetryByItself,
} from "@/components/admin/case-wizard/generate-reply";

const draft = { schemaVersion: 1, scenario: "s", discussionQuestions: [], modelAnswers: [], rubric: "r" };

test("a draft is shown", () => {
  const reply = readGenerateReply(200, { contentJson: draft });
  assert.equal(reply.kind, "ok");
});

test("the route's own message is shown as it is and not retried", () => {
  const reply = readGenerateReply(502, { error: "generation_failed", message: "The model did not answer in time." });
  assert.deepEqual(reply, { kind: "error", message: "The model did not answer in time." });
  assert.equal(shouldRetryByItself(reply, 1), false);
});

test("a gateway timeout with no JSON is retried once by itself", () => {
  const reply = readGenerateReply(504, undefined);
  assert.deepEqual(reply, { kind: "no-reply", status: 504 });
  assert.equal(shouldRetryByItself(reply, 1), true);
  assert.equal(shouldRetryByItself(reply, 2), false);
});

test("a lost connection is retried once by itself", () => {
  assert.equal(shouldRetryByItself({ kind: "no-reply", status: null }, 1), true);
});

test("the message after a second gateway timeout names it in words, not only as a status", () => {
  const message = noReplyMessage(504);
  assert.match(message, /did not answer in time/);
  assert.match(message, /Nothing was saved/);
  assert.match(message, /automatic retry/);
  assert.notEqual(message.trim(), "HTTP 504");
  assert.match(noReplyMessage(null), /connection to the server was lost/);
});
