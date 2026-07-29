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
