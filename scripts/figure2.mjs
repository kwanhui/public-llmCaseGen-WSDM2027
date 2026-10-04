// Capture the two panels of the paper's Figure 2 from a running, seeded
// instance: the retrieved-notes table of the example finance case (header and
// the five rows) and the inputs strip of its contrastive view (header and the
// five rows). Each is written at device scale 3 on a white 2.61:1 canvas, which
// is the box the paper sets the panel in.
//
//   BASE_URL=https://llmcasegen.vercel.app \
//   SIGNIN_USER=admin SIGNIN_PASS=... \
//   FIG_DIR=path/to/figures \
//   node scripts/figure2.mjs
//
// BASE_URL, SIGNIN_USER and SIGNIN_PASS are the names smoke-check
// uses. FIG_DIR defaults to ./figures-out and CASE_ID to the seeded finance
// case. The tables are found by role and text, and the crop is computed from
// the element, so a change in the page above a table does not move the capture.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const USER = process.env.SIGNIN_USER ?? "";
const PASS = process.env.SIGNIN_PASS ?? "";
const CASE_ID = process.env.CASE_ID ?? "seed-case-finance";
const FIG_DIR = path.resolve(process.env.FIG_DIR ?? "./figures-out");
// A narrower viewport gives narrower tables and so larger text once the
// capture is scaled to a column; the paper's panels use 920.
const VIEW_WIDTH = Number(process.env.VIEW_WIDTH ?? 920);

const RATIO = 2.61;
const SCALE = 3;
// White space kept around the table, in CSS pixels.
const MARGIN = 8;

if (!USER || !PASS) {
  console.error("Set SIGNIN_USER and SIGNIN_PASS.");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: VIEW_WIDTH, height: 2400 },
  deviceScaleFactor: SCALE,
  colorScheme: "light",
});
const page = await ctx.newPage();

// Screenshot one element, then centre it on a white canvas of the figure's
// ratio. The canvas is a blank page at the same device scale, so the pixels of
// the element are not resampled.
async function capture(table, rows, file) {
  await table.waitFor({ state: "visible", timeout: 60_000 });
  const found = await table.getByRole("row").count();
  if (found !== rows) {
    throw new Error(`${file}: expected ${rows} table rows including the header, found ${found}`);
  }
  const png = await table.screenshot({ type: "png" });
  const width = png.readUInt32BE(16) / SCALE;
  const height = png.readUInt32BE(20) / SCALE;

  let canvasW = width + 2 * MARGIN;
  let canvasH = height + 2 * MARGIN;
  if (canvasW / canvasH > RATIO) canvasH = canvasW / RATIO;
  else canvasW = canvasH * RATIO;
  canvasW = Math.round(canvasW);
  canvasH = Math.round(canvasH);

  const canvas = await ctx.newPage();
  await canvas.setViewportSize({ width: canvasW, height: canvasH });
  await canvas.setContent(
    `<body style="margin:0;background:#fff;width:${canvasW}px;height:${canvasH}px;` +
      `display:flex;align-items:center;justify-content:center">` +
      `<img alt="" src="data:image/png;base64,${png.toString("base64")}" ` +
      `style="width:${width}px;height:${height}px"></body>`,
  );
  const out = path.join(FIG_DIR, file);
  await canvas.screenshot({ path: out, clip: { x: 0, y: 0, width: canvasW, height: canvasH } });
  await canvas.close();
  console.log(`${out}  ${canvasW * SCALE} x ${canvasH * SCALE} px, table ${width} x ${height} CSS px`);
}

try {
  await mkdir(FIG_DIR, { recursive: true });

  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Username", { exact: true }).fill(USER);
  await page.getByLabel("Password", { exact: true }).fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  // Left panel: the Retrieval step. The retrieved-notes table is the one with a
  // Similarity column.
  await page.goto(`${BASE_URL}/admin/cases/${CASE_ID}?step=2`, { waitUntil: "networkidle" });
  const retrieved = page
    .getByRole("table")
    .filter({ has: page.getByRole("columnheader", { name: "Similarity", exact: true }) });
  await capture(retrieved, 6, "shot-retrieval.png");

  // Right panel: the contrastive view's inputs strip, the table that states
  // what each output was given (header and five rows). The readings table under
  // it is twice the height of the left panel and would not be legible at the
  // figure's height, so the paper shows the strip and reports the readings in
  // the text.
  await page.goto(`${BASE_URL}/admin/cases/${CASE_ID}/compare`, { waitUntil: "networkidle" });
  const inputs = page
    .getByRole("table")
    .filter({ has: page.getByRole("rowheader", { name: "Discipline prompt and exemplars" }) });
  await capture(inputs, 6, "shot-contrastive.png");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
