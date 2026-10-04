# Deployment notes

Notes for whoever operates the hosted instance at https://llmcasegen.vercel.app.
The environment variables and the first deploy are described in the [README](../README.md), under "Environment variables" and "Deploying to Vercel and checking a deployment"; they are not repeated here.
`OPENAI_API_KEY` is needed whichever generation provider is chosen, because briefs are always embedded with OpenAI.

`POSTGRES_URL` is set by Vercel when the project includes a Postgres store.
After the first deploy, every push to `main` deploys to production.
A deploy does not run migrations, so a schema change needs `pnpm db:migrate` run against the production `POSTGRES_URL`.

## Rotating the instructor password

```bash
pnpm change-admin-password --vercel-production
```

The command asks for the new password, hashes it, writes `ADMIN_PASSWORD_HASH` to the linked Vercel project and redeploys that project to production.
Its redeploy runs `vercel --prod`, which uploads the working tree it is run from, so run it from a clean checkout of the deployed commit.

## Checking that a deployment is reachable

`GET /api/health` is public and needs no sign-in:

```bash
curl -s https://llmcasegen.vercel.app/api/health
# {"ok":true,"db":true,"provider":"openai","keyPresent":true,"version":"<sha>"}
```

It returns 200 when the database is reachable and a generation key is set, and 503 otherwise.
It includes no secret.
After a deploy, work through `scripts/smoke-check.md` by hand in a private window.
The automated part of that checklist is:

```bash
BASE_URL=https://llmcasegen.vercel.app \
SIGNIN_USER=admin SIGNIN_PASS='<password>' \
pnpm smoke-check
```

Backend traffic is in the Logs tab of the Vercel dashboard, filtered by `path:/api/*`.
The `case_events` table is the event log of every case: the Provenance link on a case exports it as Markdown, and the analytics page exports all events as CSV.
Token counts are not logged.

## Rollback

In the Vercel dashboard, open Deployments, find the last good deployment and choose "Promote to Production".
A promotion does not change the repository, so the next push to `main` deploys over it.
`drizzle-kit` has no down migrations, so if a migration caused the failure, restore the database from the snapshot taken before it.

## Backups

Vercel Postgres takes daily snapshots, which are restored from the dashboard.
For a copy outside Vercel, run `pg_dump $POSTGRES_URL > perscase-$(date +%F).sql` from time to time.

## Known limits

There is one instructor account.
More than one would need a change to the `users` table and a way to invite instructors.
A generated case costs about US$0.02 to 0.10 at the default settings, most of it the output of the structured generation call.
