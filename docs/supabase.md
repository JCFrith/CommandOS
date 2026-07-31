# Supabase Setup & Deployment

How to run CommandOS against Postgres — locally and in production. Persistence is
**opt-in**; without it the app uses the development in-memory stores unchanged.

## Environment

| Var                             | Purpose                                             |
| ------------------------------- | --------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (also used by auth)            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (client + SSR, RLS-bound)           |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server/worker only** — bypasses RLS; never client |
| `USE_SUPABASE_PERSISTENCE`      | `1` to enable the durable Postgres path             |
| `CRON_SECRET`                   | Bearer token guarding `/api/worker` (optional)      |

`isSupabasePersistenceEnabled()` requires the first three (+ the flag). The
service-role client (`lib/supabase/service.ts`) is `server-only`.

## Local development

```
supabase start                 # local Postgres + Auth (Docker)
supabase db reset              # applies migrations/ then seed.sql
USE_SUPABASE_PERSISTENCE=1 \
  SUPABASE_SERVICE_ROLE_KEY=<local key> \
  NEXT_PUBLIC_SUPABASE_URL=<local url> ... npm run dev
# Drive the worker manually:
curl -XPOST localhost:3000/api/worker
```

Without `supabase start`, just run `npm run dev` — the in-memory path is used.

## Migrations

- Apply: `supabase migration up` (or `supabase db reset` locally).
- Roll back: run `supabase/rollback/*_rollback.sql` via `supabase db execute`.
- Types: `supabase gen types typescript` to refresh row types for the adapters.

## Testing against a database

The adapter-contract suite (`tests/unit/adapter-contract.test.ts`) runs the
in-memory implementation always; the Supabase run is **gated on
`SUPABASE_TEST_URL`** (point it at a local `supabase start` or a disposable test
project) and skipped otherwise. RLS, lease, timer-recovery, worker-recovery,
optimistic-concurrency, append-only, and immutable-version integration tests run
in the same gated mode. In an environment without Docker/CLI/DB (e.g. this build
host) these are written but not executed — tracked as TD-34.

## Production deployment (Vercel)

1. Provision a Supabase project; set the four env vars (+ `CRON_SECRET`) in
   Vercel (service key as a **server-side** secret).
2. Apply migrations to the hosted project (`supabase db push`).
3. Deploy. `vercel.json` registers the cron `* * * * * → /api/worker`, so the
   stateless worker drains due jobs/timers/schedules each minute.
4. Health for `database`/`worker`/`queue` appears on `/console/signals`.

## Security boundary

- The service-role key is only ever read server/worker-side; the client uses the
  anon key under RLS. No client-side elevation path exists.
- Adapters scope every query by `workspace_id`; the service layer authorizes
  before calling. RLS is defense-in-depth for the anon path; the service role is
  trusted but explicitly scoped. See [database.md](./database.md).

## Production validation (release gate)

These adapters are implementation-complete but **not production-verified** until
they pass against a real database (decision D-656). The fail-closed validation
package — environment probe, migration rollback/replay, adapter/RLS/concurrency/
recovery/smoke suites, and `EXPLAIN` plans — and the two ways to run it (a GitHub
Actions local Supabase stack, or an isolated hosted project via secrets) are
documented in [production-validation.md](./production-validation.md). Run it with
`npm run validate:production` against a disposable validation database; it never
targets production and never passes by skipping the database-backed suites.

## Staging & deployment

Provisioning an isolated Supabase **staging** project (never production; durability on) and deploying it is documented in [staging.md](./staging.md) and [deployment.md](./deployment.md). The canonical env-var reference (server-only vs `NEXT_PUBLIC_*`) is in [deployment.md](./deployment.md).
