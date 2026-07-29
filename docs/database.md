# Database

The PostgreSQL/Supabase schema (`supabase/migrations/`). Every table is
**workspace-partitioned** (`workspace_id`) and RLS-protected; append-only and
immutable invariants are enforced by triggers, not just by the application.

## Tables

- **Tenancy:** `workspaces`, `workspace_members` (role: owner/admin/member).
- **Operations:** `operations` (+ `row_version` for optimistic concurrency).
- **Agents:** `agents`, `agent_executions` (unique partial index enforces one
  active execution per agent — the duplicate-run guard).
- **AI logs:** `execution_logs` (append-only, secret-free).
- **Signals:** `signals` (append-only), `signal_events` (append-only lifecycle),
  `signal_subscriptions`.
- **Workflows:** `workflows`, `workflow_versions` (immutable, `unique
(workflow_id, version)`), `workflow_runs` (+ `lease_*`, `row_version`),
  `workflow_step_runs` (append-only checkpoints), `workflow_approvals` (`unique
(run_id, node_id)`).
- **Durable execution:** `trigger_claims` (`pk (workspace_id, trigger_key)` —
  idempotency), `workflow_timers` (`due_at`), `schedule_occurrences` (`pk
(workspace_id, workflow_id, occurrence_key)`), `jobs` (leased queue).

## Keys, indexes, constraints

- **PKs** are uuids (`gen_random_uuid()`); **FKs** cascade within a workspace.
- **Unique constraints** encode the platform's idempotency guarantees:
  `workflow_versions(workflow_id, version)`, `trigger_claims(workspace_id,
trigger_key)`, `workflow_approvals(run_id, node_id)`,
  `schedule_occurrences(...)`, and the partial `agent_executions` active-run index.
- **Query indexes:** signals by `(workspace_id, created_at desc)`, correlation,
  subject, type, severity; runs by workflow + correlation; a **partial** index on
  suspended runs; a **partial** claimable-jobs index `(coalesce(scheduled_for,
created_at)) where status in ('queued','running')`.

## Triggers

- `app_forbid_mutation()` — `BEFORE UPDATE OR DELETE` on every append-only table.
- `app_forbid_update()` — `BEFORE UPDATE` on `workflow_versions` (immutable).
- `app_touch_updated_at()` — maintains `updated_at` on mutable rows.

## `claim_jobs` (atomic worker claim)

A `security definer` function claims a batch of runnable jobs (queued+due OR
running+expired-lease), oldest first, with `FOR UPDATE SKIP LOCKED`, setting each
to `running` with a fresh lease and incrementing attempts — so concurrent
stateless workers never claim the same job. This is the SQL form of the leasing
model the in-memory store implements in code.

## Row Level Security

- Every tenant table: RLS on; `select` policy `app_is_member(workspace_id)`
  (membership via `workspace_members` + `auth.uid()`). Writes go through the
  server (service layer authorizes first).
- Infrastructure tables (`jobs`, `trigger_claims`, `schedule_occurrences`,
  `signal_subscriptions`): RLS on with **no** anon/auth policy → only the service
  role reaches them.
- The **service role bypasses RLS** but every adapter query is explicitly
  `workspace_id`-scoped, so bypassing RLS never bypasses tenant isolation. There
  is **no client-side elevation path** (the service key is server/worker only).

## Migrations & rollback

- Forward: `supabase/migrations/20260729000000_production_foundation.sql`
  (idempotent where practical). Applied by `supabase db reset` /
  `supabase migration up`.
- Rollback: `supabase/rollback/20260729000000_production_foundation_rollback.sql`
  (drops all objects in dependency order).
- Seed: `supabase/seed.sql` (one local personal workspace). CLI config in
  `supabase/config.toml`. See [supabase.md](./supabase.md).

## Verification status

The schema, triggers, RLS, and `claim_jobs` are written to spec. **Live-database
verification** (applying migrations + the Supabase adapter-contract + RLS +
integration suites against a running Postgres) is pending a provisioned Supabase
project / local `supabase start` — see [supabase.md](./supabase.md) and TD-34.

The portable package that performs that verification — migration rollback/replay,
adapter contracts, RLS, concurrency, recovery, smoke, and `EXPLAIN` plans — plus
how to run it (GitHub Actions local stack or an isolated hosted project) is
documented in [production-validation.md](./production-validation.md). Sprint 6.5
cannot be released until that gate reports `PASS`.
