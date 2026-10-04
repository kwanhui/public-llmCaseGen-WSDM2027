# Deployment smoke check

This checklist walks through a deployment the way a first-time visitor does: from the landing page to the live demo, then into the instructor view and out to a team link.
Run it by hand after a deploy.

Use a new private window, on an ordinary connection with no VPN or proxy, and only the public URL and the demonstration sign-in.

## Checklist

| # | Step | Expected |
| --- | --- | --- |
| 1 | Open a new private window and confirm that no VPN or corporate proxy is active | n/a |
| 2 | Fetch `https://llmcasegen.vercel.app/api/health` | HTTP 200 and JSON with `"ok": true`, `"db": true`, `"keyPresent": true` |
| 3 | Open the site's root URL | The landing page, with the workflow diagram (an instructor lane and a student lane), the comparison with a traditional case study under two tabs (Instructor, Student), the card "Try the live demo", and the link "Instructor sign-in" |
| 4 | Choose "Try the live demo" | `/demo` opens without a sign-in, headed "Live demo", with a banner saying that it is a public demo and that nothing entered is stored, and the two column headers "Standard LLM" and "PersCase" |
| 5 | Press "Run the whole demo" and wait two to three minutes | The run goes through six steps ("Step 1 of 6" to "Step 6 of 6") without an error: the retrieved notes in the PersCase column, two drafts with the readings strip, a regeneration of one PersCase section when the check flags a concept (otherwise step 3 is passed over), two team variants, and in the student scene, on the "Example bank case", a reply and a hint followed by a reply and rubric-based feedback. Each column shows its model id and elapsed time. A rate-limit message means the allowance for this address is used; wait ten minutes |
| 6 | Go back to the landing page and follow the link "Instructor sign-in" | The sign-in page, with Username and Password fields |
| 7 | Sign in with `admin` / `demo1234` | The case list, with "Signed in as" in the header |
| 8 | Read the case list | One released case per discipline (finance, marketing, social work), each marked "Seeded example" |
| 9 | Choose Open on the released finance case | The case opens at step 4, Edit and approve, with the draft and a banner saying that the case is a seeded example and read-only |
| 10 | Choose Contrastive view | Three outputs: Plain prompt; Structured, no retrieval; This case, current draft |
| 11 | Read the readings table above the three texts | The caption says the readings are lexical; must-cover concepts present and retrieved notes reflected show `n/m` in all three columns, followed by sections present and word count |
| 12 | Look at the Re-run baselines button | It is disabled on a seeded example, and the line beside it says that the baselines are fixed and that a duplicate can be re-run |
| 13 | Go back to the case and choose Team variants | At least two team variants, each with a team link |
| 14 | Open one team link in a second private window, without signing in | The student page |

## Record the run

Fill this in and keep it with the deployment's records:

```
Date checked      : YYYY-MM-DD
Checked by        :
Browser / OS      :
Network           : (home broadband / campus / mobile; no VPN)
URL               :
/api/health       : (paste the JSON)
Deployment version: (the "version" field from /api/health)
Steps failed      : (none, or the numbers above)
Notes             :
```

## If a step fails

If the health endpoint returns 503, read which field is false.
`db: false` means the database is unreachable (check `POSTGRES_URL` on the Vercel project), and `keyPresent: false` means the generation key is missing from the production environment.

If `/demo` says that the public demo is paused, `PUBLIC_DEMO` is set to `0` or `false` on the Vercel project; remove it or set it to `1` and redeploy.
If it reports that today's limit is reached, the daily counter (`DEMO_UNITS_PER_DAY`) is spent on that instance and resets at UTC midnight.
If a column reports that the model call failed, check `/api/health` and the provider's budget for the API key.

If the sign-in is rejected, the demonstration password no longer matches `ADMIN_PASSWORD_HASH`.
Set it again with `pnpm change-admin-password --vercel-production`.

If the case list is empty, the seed data was cleaned.
Re-seed with `pnpm seed-demo --yes-shared-database` against the production database, after reading the host and the row counts it prints.

If the contrastive view shows only the current draft, the comparison cache is empty for that case.
Re-seeding fills it from the committed baselines in `demo/sample-comparisons/` and makes no model call.
On a case that is not a seeded example, Run baselines fills it with two model calls.

## Automated version

`pnpm smoke-check` drives part of the path with Playwright.
It opens `/` and `/demo` (the demo must show its "Live demo" heading), checks that `/demo?run=step` shows "Step 1 of 6" and sends no retrieve or generate request before Next is pressed, and then drives steps 2, 7, 10 and 11:

```bash
BASE_URL=https://llmcasegen.vercel.app \
SIGNIN_USER=admin SIGNIN_PASS=demo1234 \
pnpm smoke-check
```

It makes no model call.
It does not replace the manual run, since it runs from your own network and does not press "Run the whole demo".
