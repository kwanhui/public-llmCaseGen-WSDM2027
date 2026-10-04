// Brings the seeded rows already in the database into line with the scenario
// normalisation that scripts/seed-demo.ts applies when it inserts them (a stray
// or whole-sentence "**" marker in a raw generation renders as literal
// asterisks on the student page; see normaliseSeedScenario there). The raw
// seed files under demo/ are not changed. Running this instead of reseeding
// keeps the synthetic student activity and the cached comparisons as they are.
//
// It touches only `contentJson.scenario` of the released seeded `cases` rows
// and of their `case_variants` rows, and only where the normalisation changes
// the text. Markers are removed; no word is added or dropped.
//
//   pnpm tsx scripts/fix-seed-scenario.ts          # dry run: print the diff, write nothing
//   pnpm tsx scripts/fix-seed-scenario.ts --apply  # write the changes

import { config as loadEnv } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { db } from "../lib/db/client";
import { cases, caseVariants } from "../lib/db/schema";
import { wordCount } from "../lib/generation/compare";
import { normaliseSeedScenario } from "./seed-demo";

loadEnv({ path: ".env.local" });
loadEnv();

const CASE_IDS = ["seed-case-finance", "seed-case-marketing", "seed-case-social-work"];
const APPLY = process.argv.includes("--apply");

interface Change {
  table: "cases" | "case_variants";
  id: string;
  label: string;
  before: string;
  after: string;
  content: Record<string, unknown>;
}

// The first line (paragraph) that the normalisation changed, before and after.
function firstChangedLine(before: string, after: string): [string, string] {
  const a = before.split("\n");
  const b = after.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return [a[i] ?? "", b[i] ?? ""];
  }
  return ["", ""];
}

function planChange(
  table: Change["table"],
  id: string,
  label: string,
  content: unknown,
): Change | null {
  if (!content || typeof content !== "object") return null;
  const c = content as Record<string, unknown>;
  if (typeof c.scenario !== "string") return null;
  const after = normaliseSeedScenario(c.scenario);
  if (after === c.scenario) return null;
  return { table, id, label, before: c.scenario, after, content: { ...c, scenario: after } };
}

function databaseHost(): string {
  try {
    return new URL(process.env.POSTGRES_URL ?? "").hostname;
  } catch {
    return "not set";
  }
}

async function main() {
  console.log(`database host: ${databaseHost()}`);
  console.log(APPLY ? "mode: apply (writes)" : "mode: dry run (no writes; pass --apply to write)");

  const changes: Change[] = [];
  const masters = await db
    .select({ id: cases.id, contentJson: cases.contentJson })
    .from(cases)
    .where(inArray(cases.id, CASE_IDS));
  if (masters.length === 0) {
    console.log("no seeded cases rows; nothing to do");
    return;
  }
  for (const m of masters) {
    const c = planChange("cases", m.id, "master", m.contentJson);
    if (c) changes.push(c);
  }

  const variants = await db
    .select({
      id: caseVariants.id,
      token: caseVariants.inviteToken,
      contentJson: caseVariants.contentJson,
    })
    .from(caseVariants)
    .where(inArray(caseVariants.caseId, CASE_IDS));
  for (const v of variants) {
    const c = planChange("case_variants", v.id, `variant ${v.token}`, v.contentJson);
    if (c) changes.push(c);
  }
  const unchanged = masters.length + variants.length - changes.length;

  console.log(
    `${changes.length} row(s) to change, ${unchanged} already clean ` +
      `(${masters.length} cases rows, ${variants.length} case_variants rows read)\n`,
  );
  for (const c of changes) {
    console.log(`--- ${c.table} ${c.id} (${c.label}) contentJson.scenario`);
    const [was, now] = firstChangedLine(c.before, c.after);
    console.log(`- ${was}`);
    console.log(`+ ${now}`);
    console.log(
      `  scenario words: ${wordCount(c.before)} -> ${wordCount(c.after)}; ` +
        `"**" markers: ${(c.before.match(/\*\*/g) ?? []).length} -> ` +
        `${(c.after.match(/\*\*/g) ?? []).length}\n`,
    );
  }

  if (!APPLY || changes.length === 0) return;
  for (const c of changes) {
    if (c.table === "cases") {
      await db.update(cases).set({ contentJson: c.content }).where(eq(cases.id, c.id));
    } else {
      await db
        .update(caseVariants)
        .set({ contentJson: c.content })
        .where(eq(caseVariants.id, c.id));
    }
    console.log(`updated ${c.table} ${c.id}`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("fix-seed-scenario.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    });
}
