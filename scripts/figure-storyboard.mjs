// Capture the four interface panels of the paper's storyboard figure (WSDM 2027
// demonstration paper, Figure 1) from the live, seeded instance. Every panel is
// a crop of one page as it renders; nothing on the page is changed, and no
// case is created, edited, generated or approved.
//
//   (a) panel-trace.png        /demo, the finance example brief, after "Retrieve
//                              notes" only (one embedding call, no model call,
//                              nothing stored): the ranked notes with their
//                              scores, the note left out and the rule that
//                              rejected it, and the concept no note mentions.
//   (b) panel-draft.png        the Edit-and-approve step of the seeded finance
//                              case: the must-cover check with the matched
//                              phrase beside each concept (DRAFT_LINES > 0 adds
//                              the first lines of the scenario under it).
//   (c) panel-variants.png     the Team variants page of the same case: one
//                              variant card, from the team name to the count of
//                              scenario sentences that differ from the case.
//   (d) panel-contrastive.png  the contrastive view of the same case: the header
//                              and top rows of the readings table (READING_ROWS),
//                              and a band of the three outputs side by side with
//                              the concept matches highlighted.
//
//   BASE_URL=https://llmcasegen.vercel.app \
//   SIGNIN_USER=admin SIGNIN_PASS=... \
//   FIG_DIR=path/to/paper/figures \
//   node scripts/figure-storyboard.mjs
//
// The viewports and crops are set below. Crops are computed from element
// boxes, and the cuts fall between lines of text or between table rows. Where
// a panel shows two regions of one page (d, and b with DRAFT_LINES > 0), they
// are placed on a white canvas with a gap, at the device scale, so the pixels
// are not resampled. In (d) the lines of the three outputs do not line up, so
// each column is cut at its own gaps between lines within the same band and
// placed at its position on the page.
// The script prints each panel's size in CSS pixels and the font sizes of the
// text it shows, which the paper uses to check the printed size.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const USER = process.env.SIGNIN_USER ?? "";
const PASS = process.env.SIGNIN_PASS ?? "";
const CASE_ID = process.env.CASE_ID ?? "seed-case-finance";
const PRESET = "Finance: valuing a regional bank with the DDM (example case)";
const VARIANT_TEAM = process.env.VARIANT_TEAM ?? "Team Beta";
const FIG_DIR = path.resolve(process.env.FIG_DIR ?? "./figures-out");

const SCALE = 3;
// Viewport widths in CSS pixels. The trace and the variant card use a narrow
// layout. The editor uses the smallest width at which each concept and its
// matched phrase sit on one line (Tailwind sm, 640). The contrastive view
// needs 1024 (Tailwind lg) for the three outputs to sit side by side.
const VIEW = {
  trace: Number(process.env.VIEW_TRACE ?? 420),
  draft: Number(process.env.VIEW_DRAFT ?? 640),
  variants: Number(process.env.VIEW_VARIANTS ?? 400),
  contrastive: 1024,
};
// Number of scenario lines shown under the concept check in panel (b).
// 0 shows the check alone.
const DRAFT_LINES = Number(process.env.DRAFT_LINES ?? 0);
// Readings-table rows shown in panel (d), after the header row.
const READING_ROWS = Number(process.env.READING_ROWS ?? 1);
// Height of the band of the three outputs in panel (d), in CSS pixels; the
// cuts are moved to the nearest gap between lines.
const BAND = Number(process.env.BAND ?? 96);
// White gap between the two regions of a stacked panel, in CSS pixels.
const GAP = Number(process.env.GAP ?? 18);
const VIEW_HEIGHT = 3200;

if (!USER || !PASS) {
  console.error("Set SIGNIN_USER and SIGNIN_PASS.");
  process.exit(1);
}

const browser = await chromium.launch();
const report = {};

async function newPage(width) {
  const ctx = await browser.newContext({
    viewport: { width, height: VIEW_HEIGHT },
    deviceScaleFactor: SCALE,
    colorScheme: "light",
  });
  return { ctx, page: await ctx.newPage() };
}

const round = (r) => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.round(r.width),
  height: Math.round(r.height),
});

// Stack PNG regions vertically on a white canvas at the device scale. Each
// part is { png, width, height } in CSS pixels; parts are left-aligned.
async function stack(ctx, parts, file) {
  const width = Math.max(...parts.map((p) => p.width));
  const height = parts.reduce((s, p) => s + p.height, 0) + GAP * (parts.length - 1);
  const canvas = await ctx.newPage();
  await canvas.setViewportSize({ width, height });
  const imgs = parts
    .map(
      (p, i) =>
        `<img alt="" src="data:image/png;base64,${p.png.toString("base64")}" ` +
        `style="display:block;width:${p.width}px;height:${p.height}px;` +
        `margin-top:${i ? GAP : 0}px">`,
    )
    .join("");
  await canvas.setContent(`<body style="margin:0;background:#fff">${imgs}</body>`);
  const out = path.join(FIG_DIR, file);
  await canvas.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  await canvas.close();
  return { out, width, height };
}

// Place PNG regions at given CSS positions on a white canvas at the device
// scale. Each part is { png, width, height, left, top } in CSS pixels.
async function place(ctx, parts, width, height, file) {
  const canvas = await ctx.newPage();
  await canvas.setViewportSize({ width, height });
  const imgs = parts
    .map(
      (p) =>
        `<img alt="" src="data:image/png;base64,${p.png.toString("base64")}" ` +
        `style="position:absolute;left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px">`,
    )
    .join("");
  await canvas.setContent(`<body style="margin:0;background:#fff;position:relative;width:${width}px;height:${height}px">${imgs}</body>`);
  const out = path.join(FIG_DIR, file);
  await canvas.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  await canvas.close();
  return { out, width, height };
}

async function shoot(page, clip, file) {
  const r = round(clip);
  const png = await page.screenshot({ clip: r, fullPage: true, type: "png" });
  if (file) await writeFile(path.join(FIG_DIR, file), png);
  return { png, width: r.width, height: r.height };
}

// Font sizes of the elements whose text the panel shows, for the report.
async function fontSizes(page, selectorTexts) {
  const out = {};
  for (const [name, text] of selectorTexts) {
    out[name] = await page
      .getByText(text, { exact: false })
      .first()
      .evaluate((e) => getComputedStyle(e).fontSize)
      .catch(() => "n/a");
  }
  return out;
}

async function signIn(page) {
  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Username", { exact: true }).fill(USER);
  await page.getByLabel("Password", { exact: true }).fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

try {
  await mkdir(FIG_DIR, { recursive: true });

  // (a) The retrieval trace on the public demo page, before any generation.
  {
    const { ctx, page } = await newPage(VIEW.trace);
    await page.goto(`${BASE_URL}/demo`, { waitUntil: "networkidle" });
    await page.locator("#demo-preset").selectOption({ label: PRESET });
    await page.getByRole("button", { name: "Retrieve notes", exact: true }).click();
    const unmentioned = page.getByText("No retrieved note mentions", { exact: false }).first();
    await unmentioned.waitFor({ state: "visible", timeout: 60_000 });
    // The reveal is staged; wait until the list has stopped growing.
    await page.waitForTimeout(3000);
    const box = await page.evaluate(() => {
      const ol = document.querySelector("ol[aria-live='off']");
      const card = ol.closest("div.rounded-md");
      const head = card.firstElementChild;
      const last = [...card.querySelectorAll("p")].find((p) =>
        p.textContent.startsWith("No retrieved note mentions"),
      );
      const c = card.getBoundingClientRect();
      const h = head.getBoundingClientRect();
      const l = last.getBoundingClientRect();
      const o = ol.getBoundingClientRect();
      return {
        x: c.x, width: c.width,
        // From the top rule of the ranked list down to the line naming the
        // concepts that no note mentions. The card's heading and the query
        // paragraph above the list, and the line on what the prompt receives
        // below, are cut.
        y: o.top + scrollY, bottom: l.bottom + scrollY + 8,
        listTop: o.top - c.top, headBottom: h.bottom - c.top,
        drafts: document.body.innerText.includes("Press Generate to write a draft in both columns from these notes."),
      };
    });
    const shot = await shoot(
      page,
      { x: box.x, y: box.y, width: box.width, height: box.bottom - box.y },
      "panel-trace.png",
    );
    report.trace = {
      url: `${BASE_URL}/demo`, viewport: VIEW.trace, css: [shot.width, shot.height],
      beforeGeneration: box.drafts,
      fonts: await fontSizes(page, [
        ["note title", "Dividend discount model"],
        ["note excerpt", "The dividend discount model values"],
        ["left out", "Left out:"],
        ["unmentioned", "No retrieved note mentions"],
      ]),
      text: await page.evaluate(() => document.querySelector("ol[aria-live='off']").closest("div.rounded-md").innerText),
    };
    await ctx.close();
  }

  // Sign in once and reuse the session for (b) to (d).
  const { ctx: adminCtx, page: login } = await newPage(VIEW.draft);
  await signIn(login);
  await login.close();

  // (b) The Edit-and-approve step: the must-cover check and the first lines of
  // the scenario.
  {
    const page = await adminCtx.newPage();
    await page.setViewportSize({ width: VIEW.draft, height: VIEW_HEIGHT });
    await page.goto(`${BASE_URL}/admin/cases/${CASE_ID}?step=4`, { waitUntil: "networkidle" });
    await page.getByText("Must-cover concepts present:", { exact: false }).first().waitFor();
    const r = await page.evaluate((lines) => {
      const det = [...document.querySelectorAll("details")].find((d) =>
        d.querySelector("summary")?.textContent.includes("Must-cover concepts present:"),
      );
      const ul = det.querySelector("ul");
      const d = det.getBoundingClientRect();
      const u = ul.getBoundingClientRect();
      // The first paragraph of the scenario, and the boxes of its lines.
      const p = [...document.querySelectorAll("p")].find((e) =>
        e.textContent.startsWith("You are a junior analyst"),
      );
      const pr = p.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(p);
      const tops = [...new Set([...range.getClientRects()].map((q) => Math.round(q.top)))].sort((a, b) => a - b);
      const lh = parseFloat(getComputedStyle(p).lineHeight);
      // Cut half a leading below the last line shown.
      const cut = tops[0] + lines * lh;
      return {
        check: { x: d.x, y: d.y + scrollY, width: d.width, height: u.bottom + 1 - d.y },
        text: { x: d.x, y: pr.top + scrollY - 8, width: d.width, height: cut - pr.top + 8 - 2 },
        lines: tops.length,
      };
    }, DRAFT_LINES);
    const a = await shoot(page, r.check, DRAFT_LINES ? undefined : "panel-draft.png");
    const out = DRAFT_LINES
      ? await stack(adminCtx, [a, await shoot(page, r.text)], "panel-draft.png")
      : { width: a.width, height: a.height };
    report.draft = {
      url: `${BASE_URL}/admin/cases/${CASE_ID}?step=4`, viewport: VIEW.draft,
      css: [out.width, out.height], regions: [round(r.check), round(r.text)],
      fonts: await fontSizes(page, [
        ["check header", "Must-cover concepts present:"],
        ["phrase", "present as “DDM”"],
        ["scenario", "You are a junior analyst"],
      ]),
    };
    await page.close();
  }

  // (c) Team variants: one card, from the team name to the line that counts
  // the scenario sentences that differ from the case. The card's buttons and
  // links below that line are cut.
  {
    const page = await adminCtx.newPage();
    await page.setViewportSize({ width: VIEW.variants, height: VIEW_HEIGHT });
    await page.goto(`${BASE_URL}/admin/cases/${CASE_ID}/variants`, { waitUntil: "networkidle" });
    await page.getByText("scenario sentences differ", { exact: false }).first().waitFor();
    const r = await page.evaluate((team) => {
      // The card whose first line is the team's name.
      const li = [...document.querySelectorAll("li")].find(
        (e) => e.innerText.split("\n")[0].trim() === team,
      );
      const diff = [...li.querySelectorAll("p,div,span")].find((e) =>
        /^\d+ of \d+ scenario sentences differ/.test(e.textContent.trim()),
      );
      const c = li.getBoundingClientRect();
      const t = diff.getBoundingClientRect();
      return { x: c.x, y: c.y + scrollY, width: c.width, height: t.bottom + 5 - c.y, text: li.innerText };
    }, VARIANT_TEAM);
    const shot = await shoot(page, r, "panel-variants.png");
    report.variants = {
      url: `${BASE_URL}/admin/cases/${CASE_ID}/variants`, viewport: VIEW.variants,
      css: [shot.width, shot.height], team: VARIANT_TEAM, text: r.text.split("\n").slice(0, 8),
      fonts: await fontSizes(page, [
        ["team", VARIANT_TEAM],
        ["context", "corporate treasury · treasury associate"],
        ["coverage", "Must-cover concepts present: 4/4"],
        ["differ", "scenario sentences differ"],
      ]),
    };
    await page.close();
  }

  // (d) The contrastive view: the header and top rows of the readings table,
  // and a band of the three outputs side by side. The lines of the three
  // columns do not line up, so each column is cut at its own gaps between
  // lines, inside the same band, and placed at its position on the page. The
  // band is the first one, from the top of the outputs, in which every column
  // shows at least one whole highlighted match.
  {
    const page = await adminCtx.newPage();
    await page.setViewportSize({ width: VIEW.contrastive, height: VIEW_HEIGHT });
    await page.goto(`${BASE_URL}/admin/cases/${CASE_ID}/compare`, { waitUntil: "networkidle" });
    await page.getByText("Readings of each output", { exact: false }).first().waitFor();
    const r = await page.evaluate(({ rows, band }) => {
      const table = document.querySelector("table[aria-describedby='readings-caption']");
      const card = table.parentElement;
      const c = card.getBoundingClientRect();
      const bodyRows = table.querySelectorAll("tbody tr");
      const lastRow = bodyRows[rows - 1].getBoundingClientRect();
      const readings = { x: c.x, y: c.y + scrollY, width: c.width, height: lastRow.bottom + 1 - c.y };
      const grid = [...document.querySelectorAll("div.grid")].find((g) =>
        g.className.includes("lg:grid-cols-3"),
      );
      const g = grid.getBoundingClientRect();
      const cols = [...grid.children];
      const bodies = cols.map((s) => s.querySelector("div.overflow-auto"));
      const lineBoxes = bodies.map((b) => {
        const boxes = [];
        const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        while (walker.nextNode()) {
          const n = walker.currentNode;
          if (!n.textContent.trim()) continue;
          range.selectNodeContents(n);
          for (const q of range.getClientRects()) boxes.push([q.top, q.bottom]);
        }
        return boxes;
      });
      const clean = (i, y) => lineBoxes[i].every(([t, b2]) => y <= t || y >= b2);
      const marks = bodies.map((b) => [...b.querySelectorAll("mark")].map((m) => m.getBoundingClientRect()));
      const top0 = Math.max(...bodies.map((b) => b.getBoundingClientRect().top));
      const bottomMax = Math.min(...bodies.map((b) => b.getBoundingClientRect().bottom));
      let best = null;
      for (let y0 = top0; y0 + band < bottomMax && !best; y0 += 1) {
        const cuts = cols.map((_, i) => {
          let a = y0;
          while (!clean(i, a)) a += 1;
          let z = y0 + band;
          while (!clean(i, z)) z -= 1;
          return [a, z];
        });
        const ok = cuts.every(([a, z], i) => z - a > 20 && marks[i].some((m) => m.top >= a && m.bottom <= z));
        if (ok) best = cuts;
      }
      return {
        readings,
        grid: { x: g.x, width: g.width },
        cols: best && cols.map((s, i) => {
          const q = s.getBoundingClientRect();
          return {
            x: q.x, y: best[i][0] + scrollY, width: q.width, height: best[i][1] - best[i][0],
            label: s.querySelector("h3").textContent,
            belowBodyTop: Math.round(best[i][0] - bodies[i].getBoundingClientRect().top),
          };
        }),
        readingsText: [...bodyRows].slice(0, rows).map((tr) => tr.innerText.replace(/\s+/g, " ")),
      };
    }, { rows: READING_ROWS, band: BAND });
    if (!r.cols) throw new Error("No band with a highlighted match in every column.");
    const table = await shoot(page, r.readings);
    const top = Math.min(...r.cols.map((q) => q.y));
    const bandH = Math.max(...r.cols.map((q) => q.y + q.height)) - top;
    const parts = [{ ...table, left: r.readings.x - r.grid.x, top: 0 }];
    for (const q of r.cols) {
      const shot = await shoot(page, q);
      parts.push({ ...shot, left: Math.round(q.x - r.grid.x), top: table.height + GAP + Math.round(q.y - top) });
    }
    const out = await place(adminCtx, parts, Math.round(r.grid.width), table.height + GAP + Math.round(bandH), "panel-contrastive.png");
    report.contrastive = {
      url: `${BASE_URL}/admin/cases/${CASE_ID}/compare`, viewport: VIEW.contrastive,
      css: [out.width, out.height], table: round(r.readings), tableHeight: table.height, gap: GAP,
      columns: r.cols.map((q) => ({ label: q.label, x: Math.round(q.x - r.grid.x), width: Math.round(q.width), belowBodyTop: q.belowBodyTop, height: Math.round(q.height) })),
      readingRows: r.readingsText,
      fonts: await fontSizes(page, [
        ["reading cell", "Must-cover concepts present"],
        ["output text", "Riverbank Regional Bank (RRB) is a mid-sized"],
      ]),
    };
    await page.close();
  }
  await adminCtx.close();

  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
