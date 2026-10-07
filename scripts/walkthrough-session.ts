// Drive one instructor walkthrough session against a deployment through the
// same routes the interface calls, so that the event log, the authoring timer
// and the regeneration count are recorded exactly as they are for a session in
// the browser. Reading the draft goes to the database directly, since reading
// is not an authoring action and the interface has no read endpoint.
//
// The session signs in once through the login page and keeps the browser
// state in WALKTHROUGH_STATE (default: .walkthrough-state.json, ignored by
// git), so that the steps of one case can be run as separate commands with
// real reading time between them.
//
//   BASE_URL=https://llmcasegen.vercel.app \
//   WALKTHROUGH_USER=admin WALKTHROUGH_PASS=... \
//   pnpm walkthrough-session create briefs/f1.json     -> prints the case id
//   pnpm walkthrough-session generate <id>
//   pnpm walkthrough-session show <id>                  -> brief, check, retrieval trace, draft
//   pnpm walkthrough-session edit <id> patch.json       -> { contentJson: {...partial} }
//   pnpm walkthrough-session regen <id> <section> [note]
//   pnpm walkthrough-session approve <id>
//   pnpm walkthrough-session variants <id> teams.json   -> [{ displayName, industry, role }, ...]
//   pnpm walkthrough-session redraft <id> <variantId> [note]
//
// The brief file holds one CaseInput: discipline, learningObjective,
// difficulty, mustCoverConcepts, targetLearnerProfile { industry, role,
// priorKnowledge }. A briefs file with several entries, each { label, brief,
// teams }, can be passed with an index: create briefs.json#2, and the same
// spec to variants reads that entry's teams.

import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { chromium, request, type APIRequestContext } from "playwright";
import { desc, eq } from "drizzle-orm";
import { db } from "../lib/db/client";
import { caseEvents, caseVariants, cases } from "../lib/db/schema";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const USER = process.env.WALKTHROUGH_USER ?? "";
const PASS = process.env.WALKTHROUGH_PASS ?? "";
const STATE = process.env.WALKTHROUGH_STATE ?? ".walkthrough-state.json";

function fail(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

function readJson(spec: string): unknown {
  const [path, index] = spec.split("#");
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (index === undefined) return parsed;
  const list = Array.isArray(parsed) ? parsed : parsed.briefs;
  if (!Array.isArray(list)) fail(`${path} holds no list to index`);
  const item = list[Number(index)];
  if (!item) fail(`${path} has no entry ${index}`);
  return item;
}

async function signIn(): Promise<void> {
  if (!USER || !PASS) fail("set WALKTHROUGH_USER and WALKTHROUGH_PASS");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", USER);
    await page.fill("#password", PASS);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.context().storageState({ path: STATE });
    console.error(`signed in as ${USER}, state saved to ${STATE}`);
  } finally {
    await browser.close();
  }
}

async function api(): Promise<APIRequestContext> {
  if (!existsSync(STATE)) await signIn();
  return request.newContext({ baseURL: BASE_URL, storageState: STATE });
}

async function call(
  method: "get" | "post" | "patch",
  path: string,
  data?: unknown,
): Promise<unknown> {
  let ctx = await api();
  let res = await ctx[method](path, data === undefined ? undefined : { data });
  if (res.status() === 401) {
    // The saved session has expired; sign in again and retry once.
    await ctx.dispose();
    await signIn();
    ctx = await api();
    res = await ctx[method](path, data === undefined ? undefined : { data });
  }
  const text = await res.text();
  await ctx.dispose();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep the text
  }
  if (!res.ok()) fail(`${method.toUpperCase()} ${path} -> ${res.status()} ${text.slice(0, 500)}`);
  return body;
}

async function show(id: string): Promise<void> {
  const [row] = await db.select().from(cases).where(eq(cases.id, id));
  if (!row) fail(`no case ${id}`);
  const events = await db
    .select()
    .from(caseEvents)
    .where(eq(caseEvents.caseId, id))
    .orderBy(desc(caseEvents.id));
  const variants = await db
    .select({ id: caseVariants.id, profile: caseVariants.learnerProfileJson })
    .from(caseVariants)
    .where(eq(caseVariants.caseId, id));
  const generated = events.find((e) => e.eventType === "generation_completed");
  const meta = (generated?.metadata ?? {}) as Record<string, unknown>;
  const out = {
    id: row.id,
    status: row.status,
    discipline: row.discipline,
    difficulty: row.difficulty,
    learningObjective: row.learningObjective,
    mustCoverConcepts: row.mustCoverConcepts,
    targetLearnerProfile: row.targetLearnerProfile,
    regenerationCount: row.regenerationCount,
    authoringStartedAt: row.authoringStartedAt,
    check: {
      conceptsCovered: meta.conceptsCovered ?? null,
      conceptsMissing: meta.conceptsMissing ?? null,
      groundingUsed: meta.groundingUsed ?? null,
      groundingCountable: meta.groundingCountable ?? null,
    },
    retrieval: meta.retrieval ?? null,
    events: events.map((e) => `${e.timestampIso} ${e.eventType}`).reverse(),
    variants,
    content: row.contentJson,
  };
  console.log(JSON.stringify(out, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "login": {
      await signIn();
      return;
    }
    case "create": {
      const item = readJson(args[0] ?? fail("create needs a brief file")) as {
        brief?: unknown;
      };
      // A briefs-file entry wraps the CaseInput in `brief` beside its label and
      // team profiles; a bare file is the CaseInput itself.
      const brief = item.brief ?? item;
      const body = (await call("post", "/api/admin/cases", brief)) as { id: string };
      console.log(body.id);
      return;
    }
    case "generate": {
      const id = args[0] ?? fail("generate needs a case id");
      await call("post", `/api/admin/cases/${id}/generate`);
      console.log(`generated ${id}`);
      return;
    }
    case "show": {
      await show(args[0] ?? fail("show needs a case id"));
      return;
    }
    case "edit": {
      const id = args[0] ?? fail("edit needs a case id");
      const patch = readJson(args[1] ?? fail("edit needs a patch file"));
      await call("patch", `/api/admin/cases/${id}`, patch);
      console.log(`edited ${id}`);
      return;
    }
    case "regen": {
      const id = args[0] ?? fail("regen needs a case id");
      const section = args[1] ?? fail("regen needs a section");
      const editorNote = args.slice(2).join(" ") || undefined;
      await call("post", `/api/admin/cases/${id}/regenerate-section`, { section, editorNote });
      console.log(`regenerated ${section} of ${id}`);
      return;
    }
    case "approve": {
      const id = args[0] ?? fail("approve needs a case id");
      const body = (await call("post", `/api/admin/cases/${id}/approve`)) as {
        authoringSeconds?: number;
      };
      console.log(`approved ${id} after ${body.authoringSeconds ?? "?"} s`);
      return;
    }
    case "variants": {
      const id = args[0] ?? fail("variants needs a case id");
      const item = readJson(args[1] ?? fail("variants needs a teams file")) as {
        teams?: unknown;
      };
      const overrides = Array.isArray(item) ? item : item.teams;
      if (!Array.isArray(overrides)) fail("the teams file must hold a list, or an entry with `teams`");
      await call("post", `/api/admin/cases/${id}/variants`, {
        count: overrides.length,
        overrides,
      });
      console.log(`spawned ${overrides.length} variants for ${id}`);
      return;
    }
    case "redraft": {
      // Regenerate one existing variant from the current master, keeping its
      // team profile and link, as the variants page's Redraft button does.
      const id = args[0] ?? fail("redraft needs a case id");
      const regenerateVariantId = args[1] ?? fail("redraft needs a variant id");
      const editorNote = args.slice(2).join(" ") || undefined;
      await call("post", `/api/admin/cases/${id}/variants`, { regenerateVariantId, editorNote });
      console.log(`redrafted variant ${regenerateVariantId} of ${id}`);
      return;
    }
    default:
      fail("commands: login | create | generate | show | edit | regen | approve | variants | redraft");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => fail(err instanceof Error ? err.message : String(err)));
