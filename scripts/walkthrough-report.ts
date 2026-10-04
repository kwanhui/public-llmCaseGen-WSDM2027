// Report what the tool recorded for the walkthrough cases, in two forms: CSV
// rows (demo/walkthrough/case-study.csv) and LaTeX rows for the paper's
// walkthrough table. Every figure comes from the database, so a row can be
// regenerated at any time, and another case can replace one by re-running
// this script with its id.
//
// This script only reads. It makes no model calls and writes nothing to the
// database.
//
//   pnpm walkthrough-report <case-id> [<case-id> ...]
//   pnpm walkthrough-report --briefs path/to/briefs.json     (ids and labels from the file)
//   pnpm walkthrough-report --briefs briefs.json --csv-out case-study.csv --rows-out walkthrough-rows.tex
//
// --csv-out writes the CSV (header and rows) to a file, and --rows-out writes
// the LaTeX rows as a \walkthroughrows macro that the paper's table expands,
// so that neither file is ever edited by hand.
//
// Columns. Time is authoring_seconds_logged (set at approval, capped at two
// hours) as mm:ss. Regenerations are the section_regenerated events. Flagged
// concepts are those the must-cover check found missing when the draft was
// generated; resolved are the flagged ones the same check finds in the approved
// draft. Notes reflected is the grounding reading (lib/retrieval/grounding.ts)
// on the approved draft against the notes retrieved for the generation.
// Variants passing counts team variants whose text still covers every
// must-cover concept, as the variants page reports.

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../lib/db/client";
import { caseEvents, caseVariants, cases } from "../lib/db/schema";
import { checkConceptCoverage } from "../lib/generation/generate-case";
import { CaseContentSchema, type CaseTextFields } from "../lib/generation/schema";
import { groundingUtilisation } from "../lib/retrieval/grounding";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export const CSV_COLUMNS = [
  "case_id",
  "discipline",
  "label",
  "brief_source",
  "date",
  "objective",
  "difficulty",
  "must_cover_concepts",
  "time_mmss",
  "regenerations_total",
  "regenerated_sections",
  "concepts_flagged",
  "concepts_resolved",
  "notes_reflected_of_countable",
  "variant1_coverage",
  "variant2_coverage",
  "edits_summary",
] as const;

interface BriefEntry {
  label: string;
  caseId?: string;
  briefSource?: string;
  discipline?: string;
}

const EMPTY: CaseTextFields = { scenario: "", discussionQuestions: [], modelAnswers: [], rubric: "" };

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function mmss(seconds: number | null): string {
  if (seconds === null) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function texEscape(s: string): string {
  return s.replace(/([&%$#_{}])/g, "\\$1");
}

function textFields(content: unknown): CaseTextFields {
  const parsed = CaseContentSchema.safeParse(content);
  return parsed.success ? parsed.data : EMPTY;
}

async function reportCase(id: string, entry?: BriefEntry) {
  const [row] = await db.select().from(cases).where(eq(cases.id, id));
  if (!row) throw new Error(`no case ${id}`);
  const events = await db
    .select()
    .from(caseEvents)
    .where(eq(caseEvents.caseId, id))
    .orderBy(asc(caseEvents.id));
  const variants = await db
    .select()
    .from(caseVariants)
    .where(eq(caseVariants.caseId, id))
    .orderBy(asc(caseVariants.createdAt));

  const mustCover = (row.mustCoverConcepts as string[]) ?? [];
  const generated = events.filter((e) => e.eventType === "generation_completed").at(-1);
  const genMeta = (generated?.metadata ?? {}) as {
    conceptsMissing?: string[];
    retrieval?: string[];
  };
  const flagged = genMeta.conceptsMissing ?? [];
  const provenance = genMeta.retrieval ?? [];

  const approved = textFields(row.contentJson);
  const coverageNow = checkConceptCoverage(approved, mustCover);
  const resolved = flagged.filter((c) => coverageNow.covered.includes(c));

  const profile = row.targetLearnerProfile as { industry: string; role: string };
  const grounding = groundingUtilisation(approved, provenance, {
    learningObjective: row.learningObjective,
    mustCoverConcepts: mustCover,
    targetLearnerProfile: profile,
  });

  const regens = events.filter((e) => e.eventType === "section_regenerated");
  const regenSections = regens.map(
    (e) => ((e.metadata ?? {}) as { section?: string }).section ?? "?",
  );

  const edits = events.filter((e) => e.eventType === "edit_saved");
  const charDelta: Record<string, number> = {};
  for (const e of edits) {
    const d = ((e.metadata ?? {}) as { charDelta?: Record<string, number> }).charDelta ?? {};
    for (const [k, v] of Object.entries(d)) charDelta[k] = (charDelta[k] ?? 0) + v;
  }
  const editsSummary =
    edits.length === 0
      ? "no in-place edits"
      : `${edits.length} save${edits.length === 1 ? "" : "s"}: ` +
        Object.entries(charDelta)
          .map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`)
          .join(", ");

  const variantCoverage = variants.map((v) => {
    const c = checkConceptCoverage(textFields(v.contentJson), mustCover);
    return c.missing.length === 0 ? "pass" : `flag:${c.missing.join("|")}`;
  });
  const variantsPassing = variantCoverage.filter((v) => v === "pass").length;

  const seconds =
    row.authoringSecondsLogged ??
    (row.authoringApprovedAt
      ? Math.floor((row.authoringApprovedAt.getTime() - row.authoringStartedAt.getTime()) / 1000)
      : null);

  const label = entry?.label ?? id;
  const csv = [
    row.id,
    row.discipline,
    label,
    entry?.briefSource ?? "",
    row.authoringStartedAt.toISOString().slice(0, 10),
    row.learningObjective,
    row.difficulty,
    mustCover.join("; "),
    mmss(seconds),
    regens.length,
    regenSections.join("; "),
    flagged.join("; "),
    resolved.join("; "),
    `${grounding.used}/${grounding.countable}`,
    variantCoverage[0] ?? "",
    variantCoverage[1] ?? "",
    editsSummary,
  ];

  const tex =
    `    ${texEscape(label)} & ${mmss(seconds)} & ${regens.length} & ` +
    `${flagged.length}/${resolved.length} & ${grounding.used}/${grounding.countable} & ` +
    `${variantsPassing}/${variants.length} \\\\`;

  return { csv, tex, status: row.status, regenCount: row.regenerationCount };
}

async function main() {
  const args = process.argv.slice(2);
  let entries: { id: string; entry?: BriefEntry }[] = [];
  const briefsFlag = args.indexOf("--briefs");
  if (briefsFlag >= 0) {
    const path = args[briefsFlag + 1];
    if (!path) throw new Error("--briefs needs a path");
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { briefs: BriefEntry[] } | BriefEntry[];
    const list = Array.isArray(parsed) ? parsed : parsed.briefs;
    entries = list
      .filter((b) => b.caseId)
      .map((b) => ({ id: b.caseId as string, entry: b }));
  } else {
    entries = args.filter((a) => !a.startsWith("-")).map((id) => ({ id }));
  }
  if (entries.length === 0) throw new Error("give case ids or --briefs <file>");

  const known = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      inArray(
        cases.id,
        entries.map((e) => e.id),
      ),
    );
  const knownIds = new Set(known.map((k) => k.id));
  for (const e of entries) if (!knownIds.has(e.id)) throw new Error(`no case ${e.id}`);

  const rows = [];
  for (const e of entries) rows.push(await reportCase(e.id, e.entry));

  const csvText = [CSV_COLUMNS.join(","), ...rows.map((r) => r.csv.map(csvCell).join(","))].join("\n") + "\n";
  const today = new Date().toISOString().slice(0, 10);
  const rowsText =
    `% Generated by \`pnpm walkthrough-report\` on ${today}. Do not edit by hand.\n` +
    "\\newcommand{\\walkthroughrows}{%\n" +
    rows.map((r) => r.tex).join("\n") +
    "\n}\n";

  console.log("## CSV");
  process.stdout.write(csvText);
  console.log("");
  console.log("## LaTeX rows (Case & Time & Regen. & Flagged/resolved & Notes reflected & Variants)");
  for (const r of rows) console.log(r.tex);
  console.log("");

  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const csvOut = flag("--csv-out");
  const rowsOut = flag("--rows-out");
  if (csvOut) {
    writeFileSync(csvOut, csvText);
    console.error(`wrote ${csvOut}`);
  }
  if (rowsOut) {
    writeFileSync(rowsOut, rowsText);
    console.error(`wrote ${rowsOut}`);
  }
  for (const [i, r] of rows.entries()) {
    if (r.status !== "approved" && r.status !== "released") {
      console.error(`note: ${entries[i].id} is ${r.status}, not approved; its time is not final`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
