/**
 * Deployment smoke check: open the public pages, sign in to a deployment,
 * open the contrastive view on a seeded case, and assert that the three arms
 * render. It automates part of the manual checklist in
 * scripts/smoke-check.md and makes no model call.
 *
 *   BASE_URL=https://llmcasegen.vercel.app \
 *   SIGNIN_USER=admin SIGNIN_PASS=... \
 *   pnpm smoke-check
 *
 * Optional: CASE_ID (default: the seeded finance case). Exits non-zero with a
 * short reason on the first failed assertion.
 */
import { chromium, type Page } from "playwright";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const USER = process.env.SIGNIN_USER ?? "";
const PASS = process.env.SIGNIN_PASS ?? "";
const CASE_ID = process.env.CASE_ID ?? "seed-case-finance";

function fail(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

// Waits for the first visible element whose text contains `text`.
async function isShown(page: Page, text: string, timeout = 20_000): Promise<boolean> {
  return page
    .getByText(text)
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

async function expectVisible(page: Page, text: string, message: string) {
  if (!(await isShown(page, text))) fail(message);
}

async function main() {
  if (!USER || !PASS) {
    fail("set SIGNIN_USER and SIGNIN_PASS (the instructor sign-in of the deployment)");
  }

  // The health endpoint is public, so a failure here separates "the deployment
  // is down" from "the login is wrong".
  const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!health) fail(`${BASE_URL}/api/health did not respond`);
  const healthBody = await health.json().catch(() => null);
  console.log(`health  ${health.status} ${JSON.stringify(healthBody)}`);
  if (!health.ok) fail("health endpoint reported the deployment is not ready");

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // The public pages first, without signing in: the landing page and the
    // demo must both be reachable by anyone with the URL.
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    for (const text of ["Instructor sign-in", "Try the live demo"]) {
      await expectVisible(page, text, `the landing page does not show "${text}"`);
      console.log(`ok      landing shows "${text}"`);
    }

    await page.goto(`${BASE_URL}/demo`, { waitUntil: "domcontentloaded" });
    for (const text of ["Live demo", "Standard LLM", "PersCase", "Public demo"]) {
      await expectVisible(page, text, `the demo page does not show "${text}"`);
      console.log(`ok      demo shows "${text}"`);
    }

    // The guided run in step mode shows its first step (the retrieval of the
    // notes) and then waits for Next, so no generate request may be sent when
    // the banner appears or in the two seconds after it. That includes a
    // retrieval request (arm "retrieve"), which makes an embedding call. The
    // page is left without pressing Next, so this check makes no model or
    // embedding call. The allowance read (arm "budget") is a generate request
    // that costs nothing and calls no model, so it is not counted.
    const generateCalls: number[] = [];
    const onRequest = (req: { url: () => string; postData: () => string | null }) => {
      if (new URL(req.url()).pathname !== "/api/demo/generate") return;
      let arm: unknown;
      try {
        arm = (JSON.parse(req.postData() ?? "{}") as { arm?: unknown }).arm;
      } catch {
        arm = undefined;
      }
      if (arm !== "budget") generateCalls.push(Date.now());
    };
    page.on("request", onRequest);
    await page.goto(`${BASE_URL}/demo?run=step`, { waitUntil: "domcontentloaded" });
    if (await isShown(page, "Step 1 of 6", 15_000)) {
      if (generateCalls.length > 0) {
        fail("?run=step sent a retrieve or generate request before the step banner appeared");
      }
      await page.waitForTimeout(2_000);
      if (generateCalls.length > 0) fail("?run=step sent a retrieve or generate request before Next was pressed");
      console.log('ok      demo ?run=step shows "Step 1 of 6" and waits for Next');
    } else if (await isShown(page, "The public demo is paused.", 1_000)) {
      console.log("skip    demo ?run=step not checked: the public demo is paused");
    } else {
      fail('the demo page with ?run=step does not show "Step 1 of 6" within 15 s');
    }
    page.off("request", onRequest);

    await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#email", USER);
    await page.fill("#password", PASS);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    console.log(`login   ok as ${USER}`);

    await page.goto(`${BASE_URL}/admin/cases/${CASE_ID}/compare`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('h1:text-is("Contrastive view")', { timeout: 20_000 });

    for (const label of ["Plain prompt", "Structured, no retrieval", "This case, current draft"]) {
      const found = await page
        .locator(`h3:text-is("${label}")`)
        .first()
        .isVisible()
        .catch(() => false);
      if (!found) fail(`the "${label}" output did not render in the contrastive view`);
      console.log(`output  ${label} rendered`);
    }

    const readings = await page.locator('th:text-is("Must-cover concepts present")').count();
    if (readings < 1) fail("the readings table did not render");
    console.log("signals readings table rendered");

    console.log(`\nPASS    smoke check passed at ${BASE_URL}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
