# Production Validation — Sprint 6.5 Release Gate

Sprint 6.5 replaces the dev-only in-memory infrastructure with production
PostgreSQL/Supabase persistence and durable execution, behind the existing
repository/store interfaces. **Compilation, unit tests, and in-memory contracts
are necessary but not sufficient** to release it (decision **D-656**). This
document describes the portable validation package that must pass against a
**real** database before Sprint 6.5 can be merged or tagged.

> **Status (2026-07-31): PASSED.** The `production-validation` workflow ran against
> real PostgreSQL (Postgres 15.8, local Supabase stack) and reported **PASS** —
> 30/30 database-backed tests, 0 required skips, canonical-schema rollback/replay
> verified, 14 hot-path `EXPLAIN` plans captured. Sprint 6.5 was released as
> **v0.6.5** and **TD-34** is resolved. Validation uncovered and fixed two genuine
> production/schema defects (migration ordering; missing table grants). Re-run this
> gate whenever the schema, adapters, or durable-execution paths change.

## What the gate proves

| Area           | What is asserted against real Postgres                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment    | Fail-closed: valid URLs, service-role server-only, not a production project, DB reachable, PG ≥ 14, pgcrypto + schema present, no in-memory fallback.                                               |
| Migration      | Applies to an empty DB; rollback removes **only** Sprint 6.5 objects; replay reproduces the canonical schema byte-for-byte.                                                                         |
| Adapters       | The in-memory **and** Supabase implementations satisfy the identical contract suites (never skipped in validation mode).                                                                            |
| RLS / security | Real authenticated identities (owner/member A, owner B, unauthorized, anon, service role): tenant isolation, append-only rejects UPDATE/DELETE, immutable versions, no client-set privileged state. |
| Concurrency    | Real concurrent connections: `FOR UPDATE SKIP LOCKED`, single trigger-claim winner, lease-ownership guards — enforced by Postgres, not app code.                                                    |
| Recovery       | Crash/lease-expiry recovery, bounded retries then terminal, no stranded work, no completion after lease loss.                                                                                       |
| Smoke          | The full app on Supabase-backed bindings; prints the active adapter per interface and fails if any binding is still in-memory.                                                                      |
| Performance    | Reproducible fixtures + `EXPLAIN (ANALYZE, BUFFERS)` for every hot query, stored as artifacts. No performance claims are hardcoded.                                                                 |

The **release gate passes only when**: zero required tests fail, zero required
tests are skipped, migrations apply, rollback + replay succeed, all Supabase
contracts pass, RLS/concurrency/recovery pass, smoke passes, and query plans are
captured without EXPLAIN failures. See `scripts/validation/report.mjs`.

## The package

```
scripts/validation/
  validate-env.mjs     fail-closed environment + schema probe
  migrate.mjs          rollback / replay reversibility check (vs canonical schema)
  gen-fixtures.mjs     reproducible perf dataset (deterministic, env-configurable)
  explain-plans.mjs    EXPLAIN (ANALYZE, BUFFERS) for every hot query
  report.mjs           aggregates results → summary.json/.md, computes the gate
  run-all.mjs          fail-closed orchestrator (npm run validate:production)
tests/integration/     database-backed suites (vitest.integration.config.ts)
  database, adapters, worker, rls, concurrency, recovery, production-smoke
supabase/validation/reset.sql   VALIDATION-ONLY reset+seed helpers (not canonical)
.github/workflows/production-validation.yml   manual release-gate workflow
```

`npm test` runs only `tests/unit/**`; the database-backed suites live under
`tests/integration/**` and run **only** through `vitest.integration.config.ts`, so
they never execute (or silently pass) without a database.

### npm scripts

| Script                                                          | Purpose                                       |
| --------------------------------------------------------------- | --------------------------------------------- |
| `db:validate:env`                                               | Fail-closed environment validator.            |
| `db:start` / `db:stop` / `db:reset` / `db:migrate`              | Local Supabase stack + migrations.            |
| `db:rollback:test` / `db:replay:test`                           | Migration reversibility check.                |
| `test:adapters:supabase`                                        | Adapter contracts against Supabase.           |
| `test:integration:database\|worker\|rls\|concurrency\|recovery` | Focused suites.                               |
| `test:production:smoke`                                         | Full-app smoke on Supabase bindings.          |
| `test:performance:database`                                     | EXPLAIN plans for hot queries.                |
| `validate:production`                                           | **Runs the whole gate and prints PASS/FAIL.** |

### Environment variables

The database-backed suites read a dedicated, disposable validation database — never
the app's runtime config:

| Variable                         | Meaning                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `SUPABASE_TEST_URL`              | Validation project API URL.                                                                       |
| `SUPABASE_TEST_ANON_KEY`         | Anon key (for RLS/identity clients).                                                              |
| `SUPABASE_TEST_SERVICE_ROLE_KEY` | Service-role key (server-only; bypasses RLS for setup).                                           |
| `SUPABASE_TEST_DB_URL`           | Direct Postgres URL (migration + EXPLAIN via `psql`/`pg_dump`).                                   |
| `SUPABASE_TEST_JWT_SECRET`       | Project JWT secret (mints authenticated identities for RLS).                                      |
| `PRODUCTION_VALIDATION=1`        | Turns on fail-closed mode (missing DB → hard error, never a skip).                                |
| `ALLOW_DESTRUCTIVE_VALIDATION`   | Explicit override required to target a recognized production project (do not set for production). |

## Path A — GitHub Actions with a local Supabase stack

1. Go to **Actions → Production Validation (Sprint 6.5) → Run workflow**.
2. Choose `mode: local` and (optionally) a `ref` (SHA/branch). Run.
3. The job: `npm ci` → installs the Supabase CLI → `supabase start` → `supabase
migration up` → applies `supabase/validation/reset.sql` → `npm run
validate:production` → uploads `artifacts/production-validation/` (even on
   failure) → always `supabase stop`.
4. Download the `production-validation-local-<run_id>` artifact and open
   `summary.md`. The workflow fails if the gate is `FAIL` or any required test was
   skipped.

## Path B — isolated hosted Supabase project

Use a **dedicated, disposable** project with no customer data.

1. Create the project; add repository secrets: `SUPABASE_TEST_URL`,
   `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`,
   `SUPABASE_TEST_DB_URL`, `SUPABASE_TEST_JWT_SECRET`.
2. Run the workflow with `mode: hosted`. It applies the canonical migration and
   validation helpers over `psql`, then runs the gate.
3. The environment validator refuses to target a recognized production project
   unless `ALLOW_DESTRUCTIVE_VALIDATION` is explicitly set — leave it unset.

### Local shell (either path, on a machine with Docker + the Supabase CLI)

```bash
npm run db:start
npm run db:migrate
psql "$SUPABASE_TEST_DB_URL" -f supabase/validation/reset.sql
PRODUCTION_VALIDATION=1 \
  SUPABASE_TEST_URL=... SUPABASE_TEST_ANON_KEY=... \
  SUPABASE_TEST_SERVICE_ROLE_KEY=... SUPABASE_TEST_DB_URL=... \
  SUPABASE_TEST_JWT_SECRET=... \
  npm run validate:production
npm run db:stop
```

## Artifacts

```
artifacts/production-validation/
  summary.json          machine-readable results + gate status
  summary.md            human-readable report (commit, env, per-suite, plans)
  test-results/         vitest JSON output
  query-plans/          EXPLAIN (ANALYZE, BUFFERS) per hot query + plans.summary.json
  migration-logs/       canonical/replayed schema snapshots + any drift diff
```

## Troubleshooting

- **`FAIL (fail-closed): … Missing: SUPABASE_TEST_*`** — the required credentials
  are absent. This is intentional: validation never passes by skipping the DB.
- **`reset failed (apply supabase/validation/reset.sql?)`** — the validation-only
  helpers were not applied after migrations (or were dropped by replay). Re-apply
  `supabase/validation/reset.sql`.
- **Schema drift after replay** — inspect `migration-logs/schema.diff.txt`. Do
  **not** edit the canonical migration to make the diff go away unless it reveals a
  real defect.
- **Seq Scan in a plan** — a review signal, not an automatic failure. Only add or
  change an index when the measured plan demonstrates the need.

## After a PASS (release procedure)

Only once a live run reports `PASS` with **zero required skips**:

1. Attach the `summary.md`/`summary.json` to the release notes; record the measured
   query plans.
2. Close **TD-34**; close or revise **TD-30/TD-31** per the results.
3. Re-run all gates (`lint`, `typecheck`, `build`, `test`) plus the validation and
   smoke suites, sync `main`, non-fast-forward merge, push, then create and push
   the annotated tag `v0.6.5`.

Until that live `PASS` report exists, Sprint 6.5 remains unreleased.

## Running against staging (hosted mode)

To rehearse the durable deployment, run this gate in **hosted** mode against an isolated Supabase **staging** project before deploying — see [staging.md](./staging.md). CI (the fast, credential-free unit gate) is separate; see [ci.md](./ci.md).
