# PersCase

PersCase is a web tool with which instructors draft professional case studies in four stages: input, retrieval, generation, and editing by the instructor.
The instructor writes a brief (discipline, learning objective, difficulty, must-cover concepts and a learner profile).
PersCase embeds the brief, retrieves notes from a corpus of notes written for each discipline, and asks a language model for a structured draft: scenario, discussion questions, model answers, rubric and key terms.
The instructor edits or regenerates any section and approves the case.
After approval, one variant of the case can be generated per student team, each with its own link, and the instructor moves the cohort through a sequence of phases.
Three disciplines are included: finance, marketing and social work.

A hosted instance runs at https://llmcasegen.vercel.app.
To try the instructor view there, sign in with username `admin` and password `demo1234`. This demonstration account is shared, so its seeded example cases and the six walkthrough cases of `demo/walkthrough/briefs.json` are read-only. The single shared account and its printed password are for demonstration purposes only. Anyone who deploys PersCase for their own use should replace them with individual accounts and stronger security, such as a password manager-generated secret, rate limiting on sign-in, and a spend cap on the model provider.

## Quick start

Requirements:

- Node 22 (`.nvmrc`; tested on 22.23.1; `package.json` accepts 20 or later) and pnpm 9.12.0.
- An OpenAI API key. It embeds each brief and, by default, generates the text. Without it the Retrieval step reports that the brief could not be embedded, and generation fails.
- A Postgres database that the `@vercel/postgres` driver can reach. That driver connects through Neon's serverless protocol, so the connection string must be a pooled Neon one (the host contains `-pooler`). A free Neon database works and needs no Vercel account. A plain local Postgres on `localhost` does not work unless Neon's WebSocket proxy is placed in front of it.

```bash
pnpm install
cp .env.example .env.local
# In .env.local, set OPENAI_API_KEY, POSTGRES_URL, AUTH_SECRET and PSEUDONYM_SALT.
openssl rand -hex 32                      # run twice, for AUTH_SECRET and PSEUDONYM_SALT
pnpm change-admin-password --local        # asks for a password, prints the ADMIN_PASSWORD_HASH line to paste
pnpm db:migrate                           # creates the tables
pnpm dev
```

Open http://localhost:3000.
The landing page shows the workflow and links to the live demo (`/demo`), to a student's view of the seeded finance case (`/case/seedretailbank01`) and to the instructor sign-in, where the username is `admin` (or `ADMIN_EMAIL`) and the password is the one just chosen.
Students need no account; they open the team link.

The migrations and the corpus vectors are committed, so `pnpm db:generate` is needed only after a change to `lib/db/schema.ts`, and `pnpm embed-corpus` only after a change to the corpus.
Without a flag, `pnpm change-admin-password` prints its usage and stops.
With `--local` it prints the bcrypt hash and changes nothing else; the printed line has a backslash before each `$`, because Next.js would otherwise expand the hash as if it named variables, so paste the line as printed.
With `--vercel-production` it rewrites `ADMIN_PASSWORD_HASH` in the linked Vercel project and redeploys that project to production.
Other checks: `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## What this repository reproduces

Retrieval is exactly reproducible from the committed vectors.
Generation is not, and a re-run of a generating script overwrites the committed file with a different sample (see "Determinism and model versions").

| Claim | Command | Output | Re-run matches? |
| --- | --- | --- | --- |
| Corpus of 97 notes (33 finance, 32 marketing, 32 social work), each 65 to 115 words | the `tsx -e` line under "Corpus statistics" | printed | yes |
| Retrieval trace for a brief: note ids and cosine scores | the `tsx -e` line under "Retrieval trace", or the Retrieval step of any case | printed | yes, to three decimals (one embedding call) |
| Retrieved notes reflected in the three committed sample drafts: 1 of 11 countable notes, of 15 retrieved. The file keeps the two earlier readings beside it, 3 of 15 when a distinctive tag counts even if the brief supplied it, and 11 of 15 when any tag counts | `pnpm grounding-report` | `demo/grounding-utilisation.json` | yes (no key or database needed) |
| Contrastive readings of the three example cases, which back the readings in the paper | `pnpm seed-demo`, then `pnpm compare-report` | `demo/comparison-readings.json` | yes on a freshly seeded database; only the commit, dirty flag and date at the top of the file differ (no model calls) |
| Draft with retrieval against draft without retrieval on the three sample briefs | `pnpm retrieval-ablation` | `demo/retrieval-ablation.json` | no (six generation calls, a few US cents) |
| Sample drafts and the ten team variants | `pnpm tsx scripts/generate-samples.ts`, `pnpm tsx scripts/generate-demo-variants.ts` | `demo/sample-outputs/`, `demo/sample-variants/` | no (generation calls) |
| Walkthrough table of the paper: six briefs, time to first approval, regenerations, flagged and resolved concepts, notes reflected, variants passing | `pnpm walkthrough-report --briefs demo/walkthrough/briefs.json --csv-out demo/walkthrough/case-study.csv` | `demo/walkthrough/case-study.csv` | needs the database that holds the six cases, which is the hosted instance's (no model calls) |
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

For the finance sample brief this prints `fin-pedagogy-assumptions 0.498`, `fin-ddm 0.490`, `fin-esg 0.434`, `fin-terminal-value 0.430` and `fin-dcf 0.423`, which are the scores recorded in `demo/sample-outputs/finance.json`.
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

`AUTH_SECRET` and `AUTH_URL` are read by Auth.js; the rest are read by the code in this repository.

| Variable | Required | Default | Purpose and how to set it |
| --- | --- | --- | --- |
| `POSTGRES_URL` | yes | none | Pooled Neon or Vercel Postgres connection string. Read by the app, by `drizzle-kit` and by the scripts that touch the database. |
| `OPENAI_API_KEY` | yes | none | Embeds each brief (always OpenAI) and generates text when `LLM_PROVIDER=openai`. |
| `AUTH_SECRET` | yes | none | Signs the instructor session. `openssl rand -hex 32`. |
| `ADMIN_PASSWORD_HASH` | yes | empty | bcrypt hash of the instructor password, with each `$` escaped. `pnpm change-admin-password --local` prints the line. While it is empty every sign-in is refused and the sign-in page says so. |
| `PSEUDONYM_SALT` | yes for view counts by device | none | Salt of the one-way hash of a student device. `openssl rand -hex 32`. If it is unset or left at the placeholder, views are logged without a device hash. |
| `ADMIN_EMAIL` | no | `admin` | The username typed at sign-in. |
| `AUTH_URL` | no | inferred | Public origin of a deployment. Leave it unset for `pnpm dev` and on Vercel. |
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
A Neon database of your own is not a local host, so the flag is needed there too; check the printed host before confirming.
Never point it at a database that a live instance uses.

`--no-comparisons` leaves the contrastive cache empty; `--regenerate-comparisons` generates new baselines instead, six model calls, and rewrites the committed files, which changes the committed readings.
`pnpm seed-demo --clean` removes the seeded rows.

## The committed vector store

The 97 vectors are committed in `lib/retrieval/corpus/embeddings.json`, so retrieval works on a fresh checkout.
`pnpm embed-corpus` rebuilds the file after a change to the corpus; it sends about 12,000 tokens in one call, which costs a fraction of a US cent and takes a few seconds.
The `RetrievalProvider` interface in `lib/retrieval/` has two implementations, the embedding provider and a `prompt-pack` provider that retrieves nothing.
The vectors are scored in memory; pgvector can replace that for a larger corpus.

## Determinism and model versions

Retrieval is deterministic: the vectors are committed and the scoring is a dot product.
Generation is not.
No call sets a seed, and the temperatures are 0.8 for the case draft (`lib/generation/generate-case.ts`), for section regeneration (`regenerate-section.ts`) and for the two contrastive baselines (`compare.ts`), 0.5 for team variants (`personalize.ts`), 0.4 for hints (`hint.ts`) and 0.3 for formative feedback (`assess-attempt.ts`).
`gpt-4o-mini` is a floating alias, so the model behind it can change without notice; set `LLM_GENERATION_MODEL` to a dated snapshot to fix it.
Every result file under `demo/` written by the current scripts carries the commit, whether the working tree was dirty, the date and, where a model was called, the model id.
The sample drafts in `demo/sample-outputs/` were written before that block was added and carry the date and the model names only.

## Adding a discipline

A discipline is defined by data files; no application code changes.
Add a `DisciplinePack` in `lib/disciplines/` (system prompt, style notes, vocabulary, difficulty instructions, exemplars, a default phase sequence, and the `quantitative` flag that adds the reminder to check figures) and a corpus of notes in `lib/retrieval/corpus/`.
Register both in `lib/disciplines/index.ts` and `lib/retrieval/corpus/index.ts`, add the id to the `DisciplineId` union in `lib/disciplines/types.ts`, and run `pnpm embed-corpus`.

## Deploying to Vercel and checking a deployment

This path needs a Vercel account and the Vercel CLI.

```bash
vercel link
vercel env add OPENAI_API_KEY production      # repeat for the required variables above
vercel env pull .env.local                    # brings POSTGRES_URL to the laptop
pnpm db:migrate
vercel --prod
```

Add a Postgres store to the project in the Vercel dashboard before the first deploy.
A deploy does not run migrations; run `pnpm db:migrate` against the production `POSTGRES_URL` after a schema change.
`demo/deployment.md` has the operator notes: password rotation, health, rollback and backups.

`GET /api/health` is public and returns `{ ok, db, provider, keyPresent, version }`, with HTTP 200 when the database is reachable and a generation key is configured, and 503 otherwise.
It includes no secrets.
`scripts/smoke-check.md` is a manual checklist to work through after a deploy, and `pnpm smoke-check` automates part of it.

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
