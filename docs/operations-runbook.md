# Operations Runbook

Operational procedures for the production persistence + durable-execution layer.
Companion to [supabase.md](./supabase.md) (setup/env), [database.md](./database.md)
(schema/RLS), [worker.md](./worker.md), and [persistence.md](./persistence.md).

> **Status:** these procedures are authored to spec. They have **not** been
> exercised against a live database in the build host (no CLI/Docker/DB — TD-34);
> run and refine them against a provisioned Supabase project before production.

## Environment (production)

Set in Vercel (service key + cron secret as protected server secrets):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `USE_SUPABASE_PERSISTENCE=1`, `CRON_SECRET`,
`OPENAI_API_KEY` (+ `OPENAI_MODEL`), `NEXT_PUBLIC_APP_URL`.

## Deployment procedure

1. **Migrate first, deploy second.** Apply migrations to the hosted DB
   (`supabase db push`) and confirm with `supabase migration list` before the app
   deploy, so no code runs against an older schema.
2. `vercel deploy --prod`. `vercel.json` registers the cron `* * * * * → /api/worker`.
3. Post-deploy: `POST /api/worker` (with the cron bearer) returns `{ ok: true }`;
   `/console/signals` shows `database`/`queue`/`worker` health green.

## Migration procedure

- **Apply:** `supabase db push` (hosted) / `supabase db reset` (local reapplies
  migrations + seed).
- **Verify:** `supabase migration list` shows the new version applied.
- **Rollback:** `supabase db execute -f
supabase/rollback/20260729000000_production_foundation_rollback.sql` (drops all
  objects in dependency order). Then re-apply the prior migration set.
- **Replay:** on a fresh DB, `supabase db reset` applies migrations from scratch —
  the migrations are idempotent where practical (`IF NOT EXISTS`).
- **Zero-downtime rule:** additive migrations only in a live deploy (add columns
  nullable/defaulted, add tables/indexes `CONCURRENTLY`); destructive changes go
  in a follow-up migration after the code no longer references the old shape.

## Worker & queue operations

- **Health signals:** `worker.heartbeat` (per tick), `job.completed`/`job.failed`.
  Absent heartbeat > 2 min ⇒ `worker` degrades (Health). Check the Vercel Cron
  logs for `/api/worker`.
- **Stuck/expired leases:** each tick auto-reclaims expired leases; a rising
  `expiredLeases` metric means jobs are exceeding the lease (raise `leaseMs` or
  lower `batchSize`).
- **Poison job:** a job that fails `max_attempts` becomes `failed` (terminal) and
  stops consuming the worker; inspect `jobs.error` and requeue after fixing.
- **Manual drain:** `POST /api/worker` (bearer) forces an out-of-band tick.

## Database maintenance

- **Autovacuum** covers `signals`/`jobs`/`workflow_step_runs` (high-churn);
  monitor bloat and tune `autovacuum_vacuum_scale_factor` on the hottest tables.
- **Index health:** review `pg_stat_user_indexes` for unused indexes; validate
  the claimable-jobs partial index and signal indexes with `EXPLAIN ANALYZE`
  (see Performance validation, TD-34) before adjusting.
- **Retention/archival:** `signals`, `execution_logs`, and terminal `jobs`/
  `workflow_runs` grow unbounded — schedule periodic archival to cold storage /
  partition by month and drop old partitions per the retention policy.

## Backup

- Supabase provides automated daily backups + PITR (point-in-time recovery) on
  paid tiers — enable PITR for the production project.
- Logical backup on demand: `supabase db dump -f backup.sql` (schema + data) or
  `pg_dump` against the connection string; store off-platform, encrypted.
- Back up **before** every migration in production.

## Restore

- **PITR:** restore the project to a timestamp via the Supabase dashboard.
- **From dump:** provision a fresh project, `supabase db reset` (schema), then
  `psql < backup.sql` (data). Re-point `NEXT_PUBLIC_SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` and redeploy.
- After restore, run the production smoke suite (see below) before taking traffic.

## Disaster recovery

- **RPO/RTO:** with PITR, RPO ≈ minutes, RTO = restore time + smoke. Document the
  agreed targets per environment.
- **Runbook:** (1) declare incident; (2) provision/restore a DB (PITR or dump);
  (3) re-key env in Vercel; (4) apply any migrations the backup predates; (5) run
  the production smoke + RLS checks; (6) resume the cron worker; (7) confirm
  `database`/`worker`/`queue` health green; (8) post-mortem.
- **Idempotency safety net:** because triggers/timers/schedules dedup via unique
  constraints (`trigger_claims`, `schedule_occurrences`) and steps are idempotent,
  replaying the worker after recovery does **not** double-execute.

## Production smoke (post-deploy / post-restore)

Run the gated production suite against the live layer (see supabase.md):
Operations · Agents · Signals + timelines · Workflow create/publish/execute/
resume/approve/schedule/timer · Queue processing · Worker heartbeat · Crash +
lease recovery · AI Runtime + execution logging · Nested correlation · Trigger
dedup · Workspace isolation · RLS · Health · Metrics · HTTP APIs · regression.

## Production database validation

Before the durable/Postgres path is released, run the fail-closed validation gate
against a real database (never production): trigger the **Production Validation
(Sprint 6.5)** GitHub Actions workflow (local stack or hosted project), review the
uploaded `summary.md`, and merge only on `PASS` with zero required skips. Full
procedure, env vars, and troubleshooting: [production-validation.md](./production-validation.md).

## Operational visibility (staging)

Every operational signal a staging operator needs already exists in the in-app
Health / Queue / Signals model — no new observability platform is added
(Sprint 6.6). Where to read each:

| Question                      | Source                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Application deployment status | Vercel dashboard (deployment/build state)                                                                                     |
| Worker invocation status      | authorized `GET/POST /api/worker` returns the tick summary (`claimed/completed/failed/reclaimed`); `worker.heartbeat` signals |
| Database connectivity         | Health `databaseReachable` (the `database` subsystem)                                                                         |
| Queue depth                   | `QueueStats.queued`                                                                                                           |
| Oldest queued job             | `QueueStats.oldestQueuedMs`                                                                                                   |
| Worker heartbeat age          | Health `workerHeartbeatAgeMs`                                                                                                 |
| Failed-job count              | `QueueStats.failed`                                                                                                           |
| Expired-lease count           | `QueueStats.expiredLeases`                                                                                                    |
| Provider availability         | Health `providerAvailable` (the `provider` subsystem)                                                                         |
| Overall health                | Health overview roll-up (worst subsystem) + `job.completed`/`job.failed` signals                                              |

These are surfaced in the authenticated console health view and computed from real
signals (never fabricated). The worker tick response requires `CRON_SECRET`.

**Known limitation — external alerting (unchanged).** There is no
unauthenticated/monitor HTTP health endpoint and **no external alerting**; the
notification framework remains **interfaces-only** (unchanged this sprint). A
staging operator determines health through the console, the secret-protected worker
tick, and the Vercel dashboard. Wiring the notification framework to a real channel
(and/or a monitor-friendly health endpoint) is future work, tracked as tech debt.

## Security review (Sprint 6.6)

Reviewed for the CI + staging deployment path; findings:

- **GitHub Actions permissions** — `ci.yml` and `production-validation.yml` both use
  `permissions: contents: read` (least privilege). Neither grants write/packages/id-token.
- **Fork PR safety** — CI uses `pull_request` (not `pull_request_target`) and reads
  no secrets, so untrusted fork code cannot exfiltrate secrets or write to the repo.
- **Secret exposure in logs** — hosted validation masks the `SUPABASE_TEST_*` secrets
  (`::add-mask::`) before writing them to `$GITHUB_ENV`; CI writes no secrets. Gate
  logs teed to `ci-logs/` contain no credentials.
- **Dependency install** — `npm ci` against the committed lockfile; no lifecycle
  scripts from feature deps are relied upon (native-install warnings are TD-A4).
- **Service-role usage** — server-only (`SUPABASE_SERVICE_ROLE_KEY`), never
  `NEXT_PUBLIC_*`; bypasses RLS but adapters always scope by `workspace_id`.
- **Cron secret** — `/api/worker` requires `Authorization: Bearer $CRON_SECRET` and
  returns `401` otherwise; not weakened for staging.
- **Adapter fallback** — the durable path is opt-in; the production-smoke suite
  fails if any binding is in-memory, so a misconfigured "durable" deploy is caught.
- **Production-project targeting safeguard** — the env validator refuses a recognized
  production project unless `ALLOW_DESTRUCTIVE_VALIDATION` is explicitly set.
- **Staging isolation** — staging uses a disposable Supabase project; validation
  truncates data, so it must never point at a project with data to keep (documented
  in [staging.md](./staging.md)).

No secrets are exposed to untrusted pull-request code. Branch protection (requiring
`CommandOS CI`) is a repo-admin setting — see [ci.md](./ci.md).

## Workspace provisioning

Real authenticated users get a persisted uuid personal workspace + owner membership
on first sign-in (server-only `app_provision_personal_workspace` RPC; idempotent,
concurrency-safe). If a durable deployment shows workspace/FK errors on create,
confirm the migration applied `owner_id` + the RPC and that the service role can
execute it. See [persistence.md](./persistence.md) / D-664.
