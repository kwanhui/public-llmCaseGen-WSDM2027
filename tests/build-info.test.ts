// The landing page footer: build commit and the optional paper link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommit, paperUrl, SOURCE_URL } from "@/lib/build-info";

test("build commit is the short Vercel sha, or null without one", () => {
  assert.equal(buildCommit({ VERCEL_GIT_COMMIT_SHA: "043bc87aa1b2c3d4e5f6" }), "043bc87");
  assert.equal(buildCommit({ VERCEL_GIT_COMMIT_SHA: "  " }), null);
  assert.equal(buildCommit({}), null);
});

test("paper link appears only for an http(s) NEXT_PUBLIC_PAPER_URL", () => {
  assert.equal(paperUrl({}), null);
  assert.equal(paperUrl({ NEXT_PUBLIC_PAPER_URL: "" }), null);
  assert.equal(paperUrl({ NEXT_PUBLIC_PAPER_URL: "not a url" }), null);
  assert.equal(paperUrl({ NEXT_PUBLIC_PAPER_URL: "javascript:alert(1)" }), null);
  assert.equal(
    paperUrl({ NEXT_PUBLIC_PAPER_URL: "https://doi.org/10.1145/example" }),
    "https://doi.org/10.1145/example",
  );
});

test("source link is the public repository", () => {
  assert.equal(SOURCE_URL, "https://github.com/kwanhui/public-llmCaseGen-WSDM2027");
});
