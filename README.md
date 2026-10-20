# PersCase

PersCase is a web tool with which instructors draft professional case studies in four stages: input, retrieval, generation, and editing by the instructor.
The instructor writes a brief (discipline, learning objective, difficulty, must-cover concepts and a learner profile).
PersCase embeds the brief, retrieves notes from a corpus of notes written for each discipline, and asks a language model for a structured draft: scenario, discussion questions, model answers, rubric and key terms.
The instructor edits or regenerates any section and approves the case.
After approval, one variant of the case can be generated per student team, each with its own link, and the instructor moves the cohort through a sequence of phases.
Three disciplines are included: finance, marketing and social work.

This repository holds the code of the system described in the paper "PersCase: A Retrieval-Augmented LLM Authoring Tool for Personalised Professional Case Studies" by Kwan Hui Lim, Lyndon Lim, Vincent Ng, Marcus Lee and Ding Ding, submitted to the WSDM 2027 Demonstrations Track.
The links given in the paper are:

- hosted instance: https://llmcasegen.vercel.app
- public demo page, no sign-in: https://llmcasegen.vercel.app/demo
- video (2:59): https://youtu.be/imaTWm3BzPE
- code: https://github.com/kwanhui/public-llmCaseGen-WSDM2027

The hosted instance is built from the `main` branch of this repository; `/api/health` reports the commit it runs.
To try the instructor view there, sign in with username `admin` and password `demo1234`, as given in the paper.
This demonstration account is shared, so its seeded example cases and the six walkthrough cases of `demo/walkthrough/briefs.json` are read-only.
The single shared account and its printed password are for demonstration purposes only.
A copy of your own must not reuse `demo1234`: choose your own password when you create `ADMIN_PASSWORD_HASH` (step 3 below), and consider further measures such as a password manager-generated secret, rate limiting on sign-in, and a spend cap on the model provider.

## Run your own copy

These steps take a fresh clone to a running instance, first on your own machine and then on a Vercel project of your own.
The hosted instance was set up the same way: a Vercel project in region `sin1` with a Neon Postgres database, built from `main`.

### 1. Prerequisites

- Node 22 (`.nvmrc`; tested on 22.23.1; `package.json` accepts 20 or later).
- pnpm 9.12.0, the version pinned in `package.json`. `corepack enable` installs it on first use.
- An OpenAI API key. It embeds each brief and, by default, generates the text. Without it the Retrieval step reports that the brief could not be embedded, and generation fails. Anthropic can be used for generation instead (see "Environment variables"), but embeddings still need the OpenAI key.
- A Postgres database that the `@vercel/postgres` driver can reach. That driver connects through Neon's serverless protocol, so the connection string must be a pooled Neon one (the host contains `-pooler`). A free Neon database (https://neon.tech) works and needs no Vercel account; on Vercel, the Neon integration in the Storage tab creates one. A plain local Postgres on `localhost` does not work unless Neon's WebSocket proxy is placed in front of it.
- For deployment, a Vercel account; the Vercel CLI (`pnpm add -g vercel`) is optional.

```bash
git clone https://github.com/kwanhui/public-llmCaseGen-WSDM2027.git perscase
cd perscase
pnpm install
```

### 2. Database

Create a Neon project and copy its pooled connection string (Neon console, Connect, with connection pooling on).
It has the form `postgresql://USER:PASSWORD@ep-NAME-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require`.
No extension is needed; the schema is plain Postgres.

### 3. Environment variables

```bash
cp .env.example .env.local
openssl rand -hex 32                      # run twice, for AUTH_SECRET and PSEUDONYM_SALT
pnpm change-admin-password --local        # asks for a password, prints the ADMIN_PASSWORD_HASH line to paste
```

In `.env.local`, set the five required variables: `POSTGRES_URL` (the string from step 2), `OPENAI_API_KEY`, `AUTH_SECRET`, `ADMIN_PASSWORD_HASH` and `PSEUDONYM_SALT`.
The rest have working defaults and are listed under "Environment variables" below.
There is one instructor account and no user table to fill: the username is `admin` (or `ADMIN_EMAIL`), and the password is the one given to `change-admin-password`.
`.env.local` is ignored by git; never commit it.

### 4. Tables and demo data

```bash
pnpm db:migrate                               # creates the nine tables from lib/db/migrations
pnpm seed-demo --yes-shared-database          # optional: the example cases the hosted instance shows
```

`pnpm seed-demo` loads the three released example cases (finance, marketing, social work) with their team variants, one finance draft, synthetic student activity for the analytics page, and the cached contrastive baselines, all from files under `demo/`.
It also loads the six walkthrough cases of `demo/walkthrough/briefs.json` from `demo/walkthrough/cases/`.
It makes no model call.
The flag is needed because a Neon host is not `localhost`; the script prints the host before it writes, and "Seeding the demo data" below says what it deletes.
The public page `/demo` writes nothing to the database, and most of it needs no seeding: its nine preset briefs are in `components/demo/presets.ts` and its fallback draft in `demo/sample-outputs/walk-finance-liquidity.json`.
Its student scene, however, reads the seeded finance case from the database, so run `pnpm seed-demo` for the copy to show the same `/demo` as the hosted instance.

### 5. Run locally

```bash
pnpm dev                                  # http://localhost:3000
```

The landing page links to `/demo`, to a student's view of the seeded finance case (`/case/seedretailbank01`) and to the instructor sign-in.
Students need no account; they open the team link.
For a production build on your own machine or server, run `pnpm build` and then `AUTH_TRUST_HOST=true pnpm start`, or set `AUTH_URL` to the public origin instead; outside `pnpm dev` and Vercel, Auth.js refuses a host it has not been told to trust.

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`.
`pnpm test` runs the unit tests in `tests/`, which need no database and no key; `pnpm smoke-check` (see "Checking a deployment") drives a running instance through the public pages, the sign-in and the contrastive view.

### 6. Deploy to a Vercel project of your own

1. Push your clone to a GitHub repository of your own (a fork works).
2. In the Vercel dashboard, choose Add New, Project, and import that repository. Vercel detects Next.js and uses pnpm from the `packageManager` field; keep the default build settings. `vercel.json` sets the region (`sin1`, which you may change) and a 120-second limit on the routes that call a model, inside which each route stops a model call that has not answered after 55 seconds and gives up within 100 seconds, so that it can still reply; on the Hobby plan a limit above 60 seconds needs fluid compute, which new projects have switched on by default.
3. In the project's Storage tab, create a Neon Postgres database and connect it to the project. This sets `POSTGRES_URL`. If you created the database in Neon directly, add `POSTGRES_URL` by hand with the pooled string from step 2.
4. In Settings, Environment Variables, add `OPENAI_API_KEY`, `AUTH_SECRET`, `PSEUDONYM_SALT` and `ADMIN_PASSWORD_HASH` for Production. On Vercel the hash is entered without the backslashes that `.env.local` needs: it starts `$2b$12$`. Leave `AUTH_URL` unset. Add any optional variable you want to change, such as `PUBLIC_DEMO=0` to switch the public demo off.
5. Run the migrations against that database from your machine. With the CLI: `vercel link`, then `vercel env pull .env.local` (which brings `POSTGRES_URL`), then `pnpm db:migrate` and, if wanted, `pnpm seed-demo --yes-shared-database`. Without the CLI, put the production `POSTGRES_URL` in `.env.local` and run the same two commands.
6. Deploy: Deployments, Redeploy, or push to `main`. Every later push to the production branch deploys to production. A deploy does not run migrations, so run `pnpm db:migrate` again after a change to `lib/db/schema.ts`.
7. Open `https://<your-project>.vercel.app/api/health`, which should report `"ok":true`, and run `pnpm smoke-check` against the new address (see "Checking a deployment").

With the CLI, steps 2 to 4 can also be done from the clone: `vercel link`, `vercel env add NAME production` for each variable, and `vercel --prod`.
`pnpm change-admin-password --vercel-production` writes a new hash to the linked project and redeploys it; `demo/deployment.md` has the other operator notes (health, rollback, backups).

### The walkthrough cases

The six walkthrough cases of `demo/walkthrough/briefs.json` were created through the interface on the hosted instance.
They are exported from its database into `demo/walkthrough/cases/`, one file per case with the case, its two team variants, its event log and, for the one case whose contrastive view was run, the cached comparison, and `pnpm seed-demo` loads them.
They keep their ids from the hosted instance, so they open at the same `/admin/cases/<id>` address and are read-only in the same way.
The team links are the one thing that differs: each is a fixed placeholder (for example `/case/walk-finance-expansion-a`) instead of the hosted instance's link.
Everything else that the hosted build uses (code, `vercel.json`, migrations, corpus and its vectors, prompts, demo presets and rate limits) is in this repository.

### Repository maintenance

The migrations and the corpus vectors are committed, so `pnpm db:generate` is needed only after a change to `lib/db/schema.ts`, and `pnpm embed-corpus` only after a change to the corpus.
Without a flag, `pnpm change-admin-password` prints its usage and stops.
With `--local` it prints the bcrypt hash and changes nothing else; the printed line has a backslash before each `$`, because Next.js would otherwise expand the hash as if it named variables, so paste the line as printed.
With `--vercel-production` it rewrites `ADMIN_PASSWORD_HASH` in the linked Vercel project and redeploys that project to production; run it from a clean checkout of the deployed commit, because the redeploy uploads the working tree.

## What this repository reproduces

Retrieval is reproducible up to the embedding of the brief: the note vectors are committed and the scoring is exact, but the brief is embedded afresh on every run (see "Determinism and model versions").
Generation is not, and a re-run of a generating script overwrites the committed file with a different sample (see "Determinism and model versions").

| Claim | Command | Output | Re-run matches? |
| --- | --- | --- | --- |
| Corpus of 97 notes (33 finance, 32 marketing, 32 social work), each 65 to 115 words | the `tsx -e` line under "Corpus statistics" | printed | yes |
| Retrieval trace for a brief: note ids and cosine scores | the `tsx -e` line under "Retrieval trace", or the Retrieval step of any case | printed | the same five notes for the three sample briefs; a score can differ by about 0.002 between runs (one embedding call) |
| Retrieved notes reflected in the three committed sample drafts: 1 of 11 countable notes, of 15 retrieved. The file keeps the two earlier readings beside it, 3 of 15 when a distinctive tag counts even if the brief supplied it, and 11 of 15 when any tag counts | `pnpm grounding-report` | `demo/grounding-utilisation.json` | yes (no key or database needed) |
| Contrastive readings of the three example cases, which back the readings in the paper | `pnpm seed-demo`, then `pnpm compare-report` | `demo/comparison-readings.json` | yes on a freshly seeded database; only the commit, dirty flag and date at the top of the file differ (no model calls) |
| Draft with retrieval against draft without retrieval on the three sample briefs | `pnpm retrieval-ablation` | `demo/retrieval-ablation.json` | no (six generation calls, a few US cents) |
| Sample drafts and the ten team variants | `pnpm tsx scripts/generate-samples.ts`, `pnpm tsx scripts/generate-demo-variants.ts` | `demo/sample-outputs/`, `demo/sample-variants/` | no (generation calls) |
| Walkthrough table of the paper: six briefs, time to first approval, regenerations, flagged and resolved concepts, notes reflected, variants passing | `pnpm walkthrough-report --briefs demo/walkthrough/briefs.json --csv-out demo/walkthrough/case-study.csv` | `demo/walkthrough/case-study.csv` | yes on a database seeded with `pnpm seed-demo`, or on the hosted instance's (no model calls) |
| Figure 2 of the paper | `node scripts/figure2.mjs` | `shot-retrieval.png` and `shot-contrastive.png` in the directory named by `FIG_DIR` | needs a seeded, running instance |
| Smoke check of a deployment: public pages, sign-in, contrastive view | `pnpm smoke-check` | pass or fail per step | needs a running instance |

### Corpus statistics

```bash
pnpm -s tsx -e 'import { CORPUS } from "./lib/retrieval/corpus"; const w = CORPUS.map((c) => c.text.trim().split(/\s+/).length); const by: Record<string, number> = {}; for (const c of CORPUS) by[c.discipline] = (by[c.discipline] ?? 0) + 1; console.log(CORPUS.length, by, Math.min(...w), Math.max(...w));'
```

This prints `97 { finance: 33, marketing: 32, social_work: 32 } 65 115`.

### Retrieval trace

```bash
pnpm -s tsx --env-file=.env.local -e 'import { readFileSync } from "node:fs"; import { retrievePreview } from "./lib/retrieval/embedding-provider"; const input = JSON.parse(readFileSync("demo/sample-inputs/finance.json", "utf8")); retrievePreview(input).then((r) => { for (const c of r.chunks) console.log(c.chunk.id, c.score.toFixed(3)); });'
```

For the finance sample brief this printed `fin-pedagogy-assumptions 0.498`, `fin-ddm 0.490`, `fin-esg 0.434`, `fin-terminal-value 0.430` and `fin-dcf 0.423` on 2026-10-20, which are the scores recorded in `demo/sample-outputs/finance.json`.
A later run can print a score that differs in the third decimal (see "Determinism and model versions").
It makes one embedding call and needs `OPENAI_API_KEY`.

### Contrastive readings

The contrastive view of a case (`/admin/cases/<id>/compare`) shows a plain prompt to the same model, the structured generation without retrieval, and the case's current draft, with the same four readings for each.
The two baselines of the three example cases are committed under `demo/sample-comparisons/`.
`pnpm seed-demo` loads them and makes no model call unless `--regenerate-comparisons` is passed, and the interface refuses to re-run them on an example case.
`pnpm compare-report` reads the cached baselines and the current draft of each case from the database that `POSTGRES_URL` points at, and makes no model calls.
With no arguments it reports the three example cases; pass case ids to report others.

### Figure 2 and the smoke check

Both use Playwright, which needs a browser installed once:

```bash
pnpm exec playwright install chromium
```

`node scripts/figure2.mjs` signs in to a running, seeded instance, opens the Retrieval step and the contrastive view of the example finance case, and writes the retrieved-notes table and the readings table as two PNG files at device scale 3 on a white 2.61:1 canvas.

`pnpm smoke-check` automates part of the manual checklist in `scripts/smoke-check.md`: it opens the landing page and `/demo`, then checks the health endpoint, the sign-in, and the contrastive view of an example case with its three outputs and its readings table.
Both scripts read `BASE_URL`, `SIGNIN_USER` and `SIGNIN_PASS`.

## Environment variables

`AUTH_SECRET`, `AUTH_URL` and `AUTH_TRUST_HOST` are read by Auth.js; the rest are read by the code in this repository.

| Variable | Required | Default | Purpose and how to set it |
| --- | --- | --- | --- |
| `POSTGRES_URL` | yes | none | Pooled Neon connection string (the host contains `-pooler`); the Neon integration on Vercel sets it. Read by the app, by `drizzle-kit` and by the scripts that touch the database. |
| `OPENAI_API_KEY` | yes | none | Embeds each brief (always OpenAI) and generates text when `LLM_PROVIDER=openai`. |
| `AUTH_SECRET` | yes | none | Signs the instructor session. `openssl rand -hex 32`. |
| `ADMIN_PASSWORD_HASH` | yes | empty | bcrypt hash of the instructor password. In `.env.local` each `$` is escaped, and `pnpm change-admin-password --local` prints the line; on Vercel the hash is entered as is. While it is empty every sign-in is refused and the sign-in page says so. |
| `PSEUDONYM_SALT` | yes for view counts by device | none | Salt of the one-way hash of a student device. `openssl rand -hex 32`. If it is unset or left at the placeholder, views are logged without a device hash. |
| `ADMIN_EMAIL` | no | `admin` | The username typed at sign-in. |
| `AUTH_URL` | no | inferred | Public origin of a deployment. Leave it unset for `pnpm dev` and on Vercel. Elsewhere, set it or `AUTH_TRUST_HOST`. |
| `AUTH_TRUST_HOST` | for `pnpm start` outside Vercel, unless `AUTH_URL` is set | unset | `true` lets Auth.js accept the request's host. Not needed for `pnpm dev` or on Vercel. |
| `LLM_PROVIDER` | no | `openai` | `openai` or `anthropic`, for generation only. |
| `ANTHROPIC_API_KEY` | only with `LLM_PROVIDER=anthropic` | none | Generation key for Anthropic. `OPENAI_API_KEY` is still needed for embeddings. |
| `LLM_GENERATION_MODEL` | no | `gpt-4o-mini`, or `claude-haiku-4-5-20251001` for Anthropic | Generation model id. |
| `EMBEDDING_MODEL` | no | `text-embedding-3-small` | Embedding model. Changing it requires `pnpm embed-corpus`, and the code assumes 1536 dimensions. |
| `RETRIEVAL_PROVIDER` | no | `embedding` | `prompt-pack` switches retrieval off, which is the baseline without retrieval. |
| `RETRIEVAL_MIN_SCORE` | no | `0.25` | Lowest cosine score at which a note is eligible. The weak-match line is 1.4 times this value. |
| `RETRIEVAL_TOP_K` | no | `5` | Most notes given to the model. |
| `VERCEL_GIT_COMMIT_SHA` | no | set by Vercel | Reported as `version` by `/api/health`. Elsewhere the package version is reported. |

The public page `/demo` reads four more, `PUBLIC_DEMO`, `DEMO_UNITS_PER_CLIENT_PER_10MIN`, `DEMO_UNITS_GLOBAL_PER_HOUR` and `DEMO_UNITS_PER_DAY`, all optional; they are described under "Live demo" below.
The scripts read a few variables of their own, each documented at the top of its file: `BASE_URL`, `SIGNIN_USER`, `SIGNIN_PASS` and `CASE_ID` (`pnpm smoke-check`, `scripts/figure2.mjs`), `FIG_DIR` and `VIEW_WIDTH` (`scripts/figure2.mjs`), `WALKTHROUGH_USER`, `WALKTHROUGH_PASS` and `WALKTHROUGH_STATE` (`pnpm walkthrough-session`, which also reads `BASE_URL`).

## Seeding the demo data (optional)

`pnpm seed-demo` inserts one released example case per discipline with team variants, one finance draft, and synthetic student activity for the analytics page.
All of its rows have ids that begin with `seed-`, and the interface treats those cases as read-only; Duplicate gives a copy that can be changed.

It rewrites the seeded rows of whatever database `POSTGRES_URL` points at: it first deletes every `seed-` row, including student responses and events attached to them, and then inserts them again.
It prints the host and what it will delete before it does anything, and it refuses a host other than `localhost` unless `--yes-shared-database` is passed.
A Neon database of your own is not a local host, so the flag is needed there too; check the printed host before running it with the flag.
On a database already in use, anything attached to the `seed-` rows, such as student responses on a seeded team link, is deleted with them; rows created through the interface are left alone.

`--no-comparisons` leaves the contrastive cache empty; `--regenerate-comparisons` generates new baselines instead, six model calls, and rewrites the committed files, which changes the committed readings.
`pnpm seed-demo --clean` removes the seeded rows.

The six walkthrough cases are loaded after the `seed-` rows, from `demo/walkthrough/cases/`, each in one transaction.
They keep the ids they have on the hosted instance, which `lib/case/seeded.ts` lists as read-only, and their timestamps are the original ones, so `pnpm walkthrough-report` reads the same figures from a seeded copy.
A walkthrough case whose id is already in the database is left as it is, so a second run inserts nothing for them, and on the hosted instance the originals are never touched.
`--clean` does not remove them.

## The committed vector store

The 97 vectors are committed in `lib/retrieval/corpus/embeddings.json`, so retrieval works on a fresh checkout.
`pnpm embed-corpus` rebuilds the file after a change to the corpus; it sends about 12,000 tokens in one call, which costs a fraction of a US cent and takes a few seconds.
The `RetrievalProvider` interface in `lib/retrieval/` has two implementations, the embedding provider and a `prompt-pack` provider that retrieves nothing.
The vectors are scored in memory; pgvector can replace that for a larger corpus.

## Determinism and model versions

Retrieval is close to deterministic but not exactly so.
The vectors of the 97 notes are committed and the cosine scoring is exact, but each run embeds the brief again, and the embedding service does not return bit-for-bit identical vectors for the same text.
Two calls made a few seconds apart usually return the same vector; calls made at different times have given scores that differ by about 0.002 (0.543 against 0.544, and 0.471 against 0.469).
A difference of that size can swap two notes whose scores are closer than that, such as `mkt-positioning-statement` (0.476) and `mkt-pedagogy-framing` (0.474) for the marketing sample brief, which changes their order in the trace and in the prompt.
It does not change which notes are taken for the three sample briefs: in each, the last note taken scores at least 0.006 above the best eligible note left out (0.423 against 0.402 for finance, 0.417 against 0.410 for marketing, 0.428 against 0.420 for social work).
A brief whose fifth and sixth notes are closer than that can take a different fifth note on another run.
Generation is not deterministic.
No call sets a seed, and the temperatures are 0.8 for the case draft (`lib/generation/generate-case.ts`), for section regeneration (`regenerate-section.ts`) and for the two contrastive baselines (`compare.ts`), 0.5 for team variants (`personalize.ts`), 0.4 for hints (`hint.ts`) and 0.3 for formative feedback (`assess-attempt.ts`).
`gpt-4o-mini` is a floating alias, so the model behind it can change without notice; set `LLM_GENERATION_MODEL` to a dated snapshot to fix it.
Every result file under `demo/` written by the current scripts carries the commit, whether the working tree was dirty, the date and, where a model was called, the model id.
The sample drafts in `demo/sample-outputs/` were written before that block was added and carry the date and the model names only.

## Adding a discipline

A discipline is defined by data files; no application code changes.
Add a `DisciplinePack` in `lib/disciplines/` (system prompt, style notes, vocabulary, difficulty instructions, exemplars, a default phase sequence, and the `quantitative` flag that adds the reminder to check figures) and a corpus of notes in `lib/retrieval/corpus/`.
Register both in `lib/disciplines/index.ts` and `lib/retrieval/corpus/index.ts`, add the id to the `DisciplineId` union in `lib/disciplines/types.ts`, and run `pnpm embed-corpus`.

## Checking a deployment

`GET /api/health` is public and returns `{ ok, db, provider, keyPresent, version }`, with HTTP 200 when the database is reachable and a generation key is configured, and 503 otherwise.
It includes no secrets.
`scripts/smoke-check.md` is a manual checklist to work through after a deploy, and `pnpm smoke-check` automates part of it:

```bash
pnpm exec playwright install chromium     # once
BASE_URL=https://<your-host> SIGNIN_USER=admin SIGNIN_PASS='<your password>' pnpm smoke-check
```

It stops at the first failure, and it expects the seeded example finance case (`CASE_ID`, default `seed-case-finance`) for the contrastive view.
`demo/deployment.md` has the operator notes: password rotation, health, rollback and backups.

## Live demo (`/demo`)

`/demo` needs no sign-in.
It sends the same brief to two columns at once, "Standard LLM" on the left and "PersCase" on the right.
The left column is either a plain prompt (the brief alone, with no retrieval, output schema or discipline prompt) or the structured generation with retrieval switched off, the same two baselines as in the contrastive view.
In the instructor scene the visitor picks one of nine preset briefs, retrieves the notes, generates both drafts, regenerates a section when the must-cover check flags a concept, and personalises both drafts for a team.
In the student scene the visitor asks for the answer and then sends an answer for feedback, on the seeded finance case or on the case just generated.
"Run the whole demo" plays these steps in order, and `demo/README.md` goes through them one by one.

The page writes nothing to the database and logs no events.
Its routes are `/api/demo/generate`, `/api/demo/personalise` and `/api/demo/student`, and every request passes the guards in `lib/demo/guards.ts` before it reaches a model:

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_DEMO` | on | `0` or `false` pauses the demo. The routes then answer 503 and the page says that the demo is paused. |
| `DEMO_UNITS_PER_CLIENT_PER_10MIN` | `24` | Units one visitor may spend in ten minutes. The visitor is identified by a hash of the forwarded IP address with a salt drawn when the process starts, held only in memory. `0` disables the check. |
| `DEMO_UNITS_GLOBAL_PER_HOUR` | `240` | Units all visitors together may spend in an hour. `0` disables the check. |
| `DEMO_UNITS_PER_DAY` | `1500` | Units all visitors together may spend per UTC day. `0` disables the check. |

A generation, a regeneration of one section or a personalisation costs 2 units per column, and a student message or a retrieval-only request costs 1.
A full scripted run makes eight `gpt-4o-mini` calls and one embedding call and costs 13 units, or 15 when the regeneration step runs.
Each model call has a cap on output tokens (6,000 for a draft or a variant, 600 for a student reply).
The counters are kept in memory per serverless instance, so traffic spread over several instances can exceed them; the only hard ceiling is the monthly budget set on the provider's API key.

## Demo materials, stack and version

A video of the tool (2:59) is at https://youtu.be/imaTWm3BzPE.
`demo/README.md` lists the sample briefs, sample drafts and sample variants, and gives the steps of a manual walkthrough.
The stack is Next.js 16 (App Router), TypeScript, Tailwind, Auth.js v5, the Vercel AI SDK, Postgres through `@vercel/postgres` with Drizzle, and Recharts; the hosted instance runs on Vercel in region `sin1`.
The version submitted to WSDM 2027 carries the tag `wsdm2027-submission`.

## Licence and citation

The code is released under the MIT licence (see `LICENSE`).
The 97 corpus notes in `lib/retrieval/corpus/` were written based on the domains of finance, marketing and social work, are not extracts from textbooks or papers, and are released under the same licence.

To cite PersCase, use `CITATION.cff` or:

```bibtex
@unpublished{Lim2027WSDM,
  author = {Lim, Kwan Hui and Lim, Lyndon and Ng, Vincent and Lee, Marcus and Ding, Ding},
  title  = {{PersCase}: A Retrieval-Augmented {LLM} Authoring Tool for Personalised Professional Case Studies},
  note   = {Under review at the WSDM 2027 Demonstrations Track},
  year   = {2027}
}
```
