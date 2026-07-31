# Staging Environment

Staging converts "validated in a disposable local stack" into "operational on a real
hosted deployment" before Sprint 7 (decision **D-663**). It is a **dedicated,
disposable** Supabase project + a Vercel deployment with durable persistence
**on** — **never** a production project, **never** production customer data.

> **Status:** this is the executable playbook. The build/session host cannot
> provision a hosted Supabase project, a Vercel deployment, or GitHub secrets on the
> owner's behalf (cost + credential-handling + account-scoped actions). An operator
> with the relevant accounts runs the steps below; the results are then recorded in
> [production-validation.md](./production-validation.md) and PROJECT_STATUS.

## What staging is

- **Vercel** project (Preview or a dedicated `staging` environment).
- An **isolated Supabase project** (its own org project, disposable).
- `USE_SUPABASE_PERSISTENCE=1` → the existing durable adapters + `/api/worker` cron.
- No production data; no reuse of any production Supabase project.

## Prerequisites

- A Supabase account with capacity for a new project.
- A Vercel account linked to the repo (or the Vercel CLI).
- Admin on the GitHub repo (to set Actions secrets for hosted validation + branch
  protection).
- Local `supabase` CLI + `psql` only if applying migrations from a workstation.

## Step 1 — Create the isolated Supabase staging project

Create a **new** Supabase project (e.g. `commandos-staging`). Record, from
Project Settings → API / Database:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- anon/public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- service_role key → `SUPABASE_SERVICE_ROLE_KEY` (**server-only**)
- connection string → for applying migrations (`SUPABASE_TEST_DB_URL` in validation)
- JWT secret (Settings → API → JWT) → `SUPABASE_TEST_JWT_SECRET` (validation only)

## Step 2 — Apply the canonical schema

```bash
# From a machine with psql + the staging DB URL:
for f in supabase/migrations/*.sql; do psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f "$f"; done
# Validation-only helpers (only needed for the hosted validation run):
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/validation/reset.sql
```

(Or link the project and `supabase db push`.) The migration includes the table
grants and RLS fixed during Sprint 6.5, so `service_role`/authenticated access
works out of the box.

## Step 3 — Hosted production-validation against staging

Set the GitHub Actions **secrets** (Settings → Secrets and variables → Actions):

- `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`,
  `SUPABASE_TEST_DB_URL`, `SUPABASE_TEST_JWT_SECRET` — all pointing at **staging**.

Then run the release gate against staging:

- **Actions → Production Validation (Sprint 6.5) → Run workflow → mode: `hosted`.**

It applies the migration + helpers over `psql`, runs `npm run validate:production`
(env probe → migration rollback/replay → adapter/RLS/concurrency/recovery/smoke
suites → fixtures → EXPLAIN), and uploads artifacts. **Do not proceed** unless it is
`PASS` with zero required skips. The env validator refuses a recognized production
project unless `ALLOW_DESTRUCTIVE_VALIDATION` is set — leave it unset.

> ⚠️ `production-validation` **truncates** all tables (it is a validation harness).
> Run it only against the disposable staging/validation database, never a database
> with data you want to keep.

## Step 4 — Configure + deploy the Vercel staging app

Set the Vercel environment variables (server-only ones in the encrypted scope — see
the matrix in [deployment.md](./deployment.md)):

```
NEXT_PUBLIC_SUPABASE_URL       = <staging project url>
NEXT_PUBLIC_SUPABASE_ANON_KEY  = <staging anon key>
SUPABASE_SERVICE_ROLE_KEY      = <staging service_role key>   # server-only
USE_SUPABASE_PERSISTENCE       = 1
CRON_SECRET                    = <a strong random secret>     # server-only
NEXT_PUBLIC_APP_URL            = <staging deployment url>
OPENAI_API_KEY                 = <optional; AI features>      # server-only
```

Deploy. Confirm the Cron Job `* * * * * → /api/worker` is registered.

## Step 5 — Deployment smoke tests

Exercise the full deployed path and record results. **Data must survive** a new HTTP
request, a cold start, a new function instance, and (where practical) a redeploy.

**Persistence + reads**

- [ ] Authentication (sign in) and workspace access
- [ ] Operations create/read/update; **Operation activity** persists chronologically
- [ ] Agents create/read; **Agent activity** persists
- [ ] Signals persist; signal **timeline**, **correlation**, and **subject** queries
- [ ] AI execution logging (if `OPENAI_API_KEY` set)
- [ ] Workflow definitions, **versions** (immutable), **runs**, **step runs**, **approvals**

**Execution**

- [ ] Manual workflow trigger starts a run
- [ ] Signal-triggered workflow (see the TD-36 caveat below)
- [ ] Scheduled workflow (see the TD-36 caveat below)
- [ ] Trigger **deduplication** (one run per occurrence)
- [ ] Timers / **delay** node resume; **approval** resume
- [ ] Worker executes queued jobs; **heartbeat** emitted
- [ ] **Lease recovery** (a stranded job is reclaimed on a later tick)
- [ ] Queue health + database health surfaces are reachable

**Isolation + surfaces**

- [ ] Workspace isolation + RLS (a member of A cannot see B)
- [ ] HTTP routes and the command palette function
- [ ] **Restart persistence** — re-read created data after a cold start / redeploy

**Adapter proof (critical):**

- [ ] Print + record the active adapter for **every** repository binding and confirm
      **none** is `InMemory*`. The production-validation smoke suite does this and
      fails if any binding is in-memory; the hosted run in Step 3 is the record.

## Step 6 — Worker + Cron validation

- [ ] Authorized `POST /api/worker` with `Authorization: Bearer $CRON_SECRET` → tick summary
- [ ] Request **without** the secret → `401` (do not weaken this)
- [ ] Queued job is claimed; heartbeat recorded; successful completion
- [ ] Retry on handler failure; **lease expiry** reclaim
- [ ] Overdue timer processing; scheduled-workflow processing
- [ ] Duplicate cron invocation is safe (idempotent claim; `SKIP LOCKED`)

## Known limitations at staging

- **Signal/schedule workflow triggers** rely on in-process registration and are not
  reliable across serverless instances (**TD-36 / D-662**). Expect manual triggers +
  the durable worker to be reliable; treat signal/schedule triggers as best-effort
  until durable trigger evaluation lands (Sprint 7). Verify this behavior explicitly
  rather than assuming.
- **External alerting** is not implemented; observability is the in-app
  Health/Metrics/Signals surfaces (see [operations-runbook.md](./operations-runbook.md)).
- **Mid-flight cancellation** of a running agent/AI call is not wired (TD-31).

## Cleanup

Staging is disposable. To tear down:

1. Delete the Vercel staging deployment/project (or unset its env vars).
2. Delete the Supabase staging project (removes all data + credentials).
3. Remove or rotate the `SUPABASE_TEST_*` GitHub secrets if they were staging-only.
4. Rotate `CRON_SECRET` if it may have been exposed.

Never leave a staging service-role key or DB URL in a shared location after teardown.

## After a green staging run

Record the hosted-validation `summary.md` + smoke results in
[production-validation.md](./production-validation.md) and PROJECT_STATUS, then
proceed to the v0.6.6 release gates in the operational-readiness release procedure.
