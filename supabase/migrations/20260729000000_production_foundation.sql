-- CommandOS — Sprint 6.5 Production Foundation
-- Complete schema: tenancy, operations, agents, AI execution logs, signals,
-- workflows, and durable-execution primitives (trigger claims, timers,
-- schedule occurrences, jobs). Append-only + immutable-version + auto-timestamp
-- triggers, workspace-partitioned RLS, and service-role boundaries.
--
-- Idempotent where practical (IF NOT EXISTS) so it is safe to re-apply in dev.

create extension if not exists "pgcrypto";

-- ============================================================================
-- Shared helpers
-- ============================================================================
-- NOTE: `app_is_member` is defined later, immediately before the RLS section —
-- it is a `language sql` function whose body is validated at creation time, so
-- it must come AFTER `workspace_members` exists. The trigger helpers below are
-- `plpgsql` (bodies not validated at creation) and are referenced by triggers
-- created after the tables, so they are safe to define up front.

-- Reject UPDATE/DELETE on append-only tables.
create or replace function app_forbid_mutation() returns trigger
  language plpgsql as $$
begin
  raise exception 'Table % is append-only; % is not permitted', tg_table_name, tg_op;
end;
$$;

-- Reject any UPDATE to an immutable row (workflow_versions).
create or replace function app_forbid_update() returns trigger
  language plpgsql as $$
begin
  raise exception 'Row in % is immutable and cannot be updated', tg_table_name;
end;
$$;

-- Maintain updated_at on UPDATE.
create or replace function app_touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- Tenancy
-- ============================================================================

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  kind text not null check (kind in ('personal','team')),
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists idx_members_user on workspace_members (user_id);

-- Personal-workspace ownership. `owner_id` marks the owning user of a PERSONAL
-- workspace; the partial unique index enforces exactly one personal workspace per
-- owner and makes concurrent first-request provisioning race-safe (a losing
-- inserter resolves the winner). Team workspaces (owner_id null) are unaffected
-- and may be many. Added via ALTER (idempotent) so already-applied databases gain
-- the column on re-apply.
alter table workspaces add column if not exists owner_id uuid;
create unique index if not exists uq_workspace_personal_owner
  on workspaces (owner_id) where kind = 'personal';

-- Idempotent, concurrency-safe personal-workspace provisioning. Called
-- SERVER-SIDE with the service role and a TRUSTED authenticated user id (never
-- client-chosen): returns the user's personal workspace, creating it + the owner
-- membership on first call. `security definer` so it writes through RLS; execute
-- is revoked from public and granted only to the service role, so no anon or
-- authenticated client can invoke it or provision for another user.
create or replace function app_provision_personal_workspace(p_user_id uuid, p_name text)
  returns workspaces language plpgsql security definer set search_path = public as $$
declare ws public.workspaces;
begin
  select * into ws from workspaces where owner_id = p_user_id and kind = 'personal' limit 1;
  if not found then
    insert into workspaces (owner_id, name, slug, kind)
      values (p_user_id, coalesce(nullif(p_name, ''), 'Personal workspace'), 'personal', 'personal')
      on conflict (owner_id) where kind = 'personal' do nothing
      returning * into ws;
    if ws.id is null then
      select * into ws from workspaces where owner_id = p_user_id and kind = 'personal' limit 1;
    end if;
  end if;
  insert into workspace_members (workspace_id, user_id, role)
    values (ws.id, p_user_id, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  return ws;
end $$;
-- Server-only: revoke from public AND from anon/authenticated (Supabase's default
-- privileges grant execute on new public functions directly to those roles, so
-- revoking from public alone is not enough). Only the service role — used by the
-- server with a trusted user id — may provision.
revoke all on function app_provision_personal_workspace(uuid, text) from public, anon, authenticated;
grant execute on function app_provision_personal_workspace(uuid, text) to service_role;

-- ============================================================================
-- Operations
-- ============================================================================

create table if not exists operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  description text,
  status text not null,
  priority text not null,
  created_by uuid not null,
  updated_by uuid not null,
  row_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_operations_ws on operations (workspace_id, updated_at desc);

create table if not exists operation_activity (       -- append-only timeline
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  operation_id uuid not null references operations(id) on delete cascade,
  actor_id uuid not null,
  actor_name text not null,
  type text not null,
  message text not null,
  from_status text,
  to_status text,
  created_at timestamptz not null default now()
);
create index if not exists idx_op_activity on operation_activity (workspace_id, operation_id, created_at, id);

-- ============================================================================
-- Agents + executions
-- ============================================================================

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  type text not null,
  description text,
  instructions text,
  capabilities text[] not null default '{}',
  status text not null,
  created_by uuid not null,
  updated_by uuid not null,
  row_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_agents_ws on agents (workspace_id, updated_at desc);

create table if not exists agent_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  requested_by uuid not null,
  status text not null,
  input text not null,
  result jsonb,
  error text,
  model text,
  prompt_version text,
  duration_ms int,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_agent_exec on agent_executions (workspace_id, agent_id, created_at desc);

create table if not exists agent_activity (           -- append-only timeline
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  actor_id uuid not null,
  actor_name text not null,
  type text not null,
  message text not null,
  from_status text,
  to_status text,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_activity on agent_activity (workspace_id, agent_id, created_at, id);
-- One active execution per agent (mirrors the duplicate-run guard).
create unique index if not exists uq_agent_active_exec
  on agent_executions (workspace_id, agent_id)
  where status in ('pending','running');

-- ============================================================================
-- AI execution logs (append-only, secret-free)
-- ============================================================================

create table if not exists execution_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  request_id uuid not null,
  correlation_id uuid,
  operator_id uuid,
  subject_id uuid,
  subject_type text,
  provider text not null,
  model text not null,
  status text not null,
  duration_ms int not null,
  attempts int not null,
  tool_calls int not null default 0,
  usage jsonb not null,
  cost jsonb not null,
  events jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_exec_logs_ws on execution_logs (workspace_id, created_at desc);
create index if not exists idx_exec_logs_corr on execution_logs (workspace_id, correlation_id);

-- ============================================================================
-- Signals (append-only) + lifecycle events + subscriptions
-- ============================================================================

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,                     -- may be 'system' sentinel; not FK'd
  type text not null,
  correlation_id uuid not null,
  parent_id uuid,
  actor_id uuid,
  actor_name text,
  source text not null,
  category text not null,
  severity text not null,
  title text not null,
  summary text not null,
  payload jsonb not null default '{}',
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',
  subject_type text,
  subject_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_signals_ws_created on signals (workspace_id, created_at desc);
create index if not exists idx_signals_corr on signals (workspace_id, correlation_id);
create index if not exists idx_signals_subject on signals (workspace_id, subject_type, subject_id);
create index if not exists idx_signals_type on signals (workspace_id, type);
create index if not exists idx_signals_severity on signals (workspace_id, severity);

create table if not exists signal_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  signal_id uuid not null references signals(id) on delete cascade,
  type text not null,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  detail text,
  resolution text
);
create index if not exists idx_signal_events_signal on signal_events (workspace_id, signal_id, at);

create table if not exists signal_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,                              -- null = platform-wide
  filter jsonb not null,
  channel_refs text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Workflows + immutable versions + runs + steps + approvals
-- ============================================================================

create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  status text not null,
  current_version_id uuid,
  created_by uuid not null,
  updated_by uuid not null,
  row_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_workflows_ws on workflows (workspace_id, updated_at desc);

create table if not exists workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  version int not null,
  nodes jsonb not null,
  edges jsonb not null,
  triggers jsonb not null,
  variables jsonb not null,
  start_node_id text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (workflow_id, version)                   -- immutable, monotonic
);

create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  version_id uuid not null references workflow_versions(id),
  correlation_id uuid not null,
  status text not null,
  trigger jsonb not null,
  trigger_key text,
  variables jsonb not null default '{}',
  frontier text[] not null default '{}',
  join_arrivals jsonb not null default '{}',
  error text,
  started_by uuid not null,
  lease_until timestamptz,
  lease_worker text,
  row_version int not null default 0,             -- optimistic concurrency
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_runs_ws_wf on workflow_runs (workspace_id, workflow_id, created_at desc);
create index if not exists idx_runs_corr on workflow_runs (workspace_id, correlation_id);
create index if not exists idx_runs_suspended on workflow_runs (status) where status in ('waiting_timer','waiting_approval');

create table if not exists workflow_step_runs (        -- append-only checkpoints
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  status text not null,
  attempts int not null,
  output jsonb not null default '{}',
  error text,
  started_at timestamptz not null,
  completed_at timestamptz
);
create index if not exists idx_steps_run on workflow_step_runs (workspace_id, run_id, started_at);

create table if not exists workflow_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  prompt text not null,
  approvers text not null,
  status text not null,
  decided_by uuid,
  decided_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  unique (run_id, node_id)                         -- one gate per run node
);
create index if not exists idx_approvals_pending on workflow_approvals (workspace_id) where status = 'pending';

-- ============================================================================
-- Durable-execution primitives
-- ============================================================================

-- Idempotency: one run per trigger occurrence.
create table if not exists trigger_claims (
  workspace_id uuid not null,
  trigger_key text not null,
  run_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, trigger_key)
);

-- Resumable timers (delay nodes). `node_id` pins the suspended delay node so a
-- resume re-advances the right frontier; `unique (run_id, node_id)` makes timer
-- creation idempotent (a re-suspension on the same node upserts, never duplicates).
-- `claimed_at` is the atomic claim/consumed marker set by the durable timer pass.
create table if not exists workflow_timers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null default '',
  due_at timestamptz not null,
  claimed_at timestamptz,
  unique (run_id, node_id)
);
create index if not exists idx_timers_due on workflow_timers (due_at) where claimed_at is null;

-- Schedule dedup — one firing per occurrence.
create table if not exists schedule_occurrences (
  workspace_id uuid not null,
  workflow_id uuid not null,
  occurrence_key text not null,
  fired_at timestamptz not null default now(),
  primary key (workspace_id, workflow_id, occurrence_key)
);

-- Durable trigger-scan progress (Sprint 7 Phase 1). One row per workspace marks how
-- far the worker has scanned `signals` for signal-trigger evaluation. It is a
-- progress marker / optimization, NOT the deduplication mechanism — `trigger_claims`
-- is authoritative (D-665). Advancement is monotonic (`created_at ASC, id ASC`), so
-- concurrent scans are redundant but never lose work.
create table if not exists trigger_scan_cursor (
  workspace_id uuid primary key,
  last_signal_created_at timestamptz not null default 'epoch',
  last_signal_id uuid,
  updated_at timestamptz not null default now()
);
-- Ordered signal scan for trigger evaluation: workspace-scoped, (created_at, id) ASC.
create index if not exists idx_signals_scan on signals (workspace_id, created_at, id);

-- Atomic claim → create run → enqueue (Sprint 7 Phase 1, D-666). One transaction so
-- a crash can never leave a claimed occurrence stranded without a run+job. Idempotent:
-- re-processing the same occurrence conflicts on `trigger_claims (workspace_id,
-- trigger_key)` and returns the existing run without creating another run or job.
-- Server-only (trusted user id from the server session).
create or replace function app_claim_trigger_run(
  p_workspace uuid, p_trigger_key text, p_run_id uuid, p_workflow_id uuid, p_version_id uuid,
  p_correlation_id uuid, p_trigger jsonb, p_variables jsonb, p_started_by uuid,
  p_job_kind text, p_now timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing uuid;
begin
  insert into trigger_claims (workspace_id, trigger_key, run_id, created_at)
    values (p_workspace, p_trigger_key, p_run_id, p_now)
    on conflict (workspace_id, trigger_key) do nothing;
  if not found then
    select run_id into v_existing from trigger_claims
      where workspace_id = p_workspace and trigger_key = p_trigger_key;
    return jsonb_build_object('claimed', false, 'run_id', v_existing);
  end if;
  insert into workflow_runs (id, workspace_id, workflow_id, version_id, correlation_id,
      status, trigger, trigger_key, variables, frontier, join_arrivals, started_by, created_at, updated_at)
    values (p_run_id, p_workspace, p_workflow_id, p_version_id, p_correlation_id,
      'pending', p_trigger, p_trigger_key, coalesce(p_variables, '{}'::jsonb), '{}', '{}', p_started_by, p_now, p_now);
  insert into jobs (workspace_id, kind, payload, status, created_at, updated_at)
    values (p_workspace, p_job_kind,
      jsonb_build_object('workspaceId', p_workspace, 'runId', p_run_id, 'versionId', p_version_id),
      'queued', p_now, p_now);
  return jsonb_build_object('claimed', true, 'run_id', p_run_id);
end $$;

-- Monotonic cursor advance: concurrent workers can only move the cursor FORWARD under
-- (created_at, id); a stale writer's update is a no-op (D-665).
create or replace function app_advance_trigger_cursor(
  p_workspace uuid, p_created_at timestamptz, p_signal_id uuid, p_now timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into trigger_scan_cursor (workspace_id, last_signal_created_at, last_signal_id, updated_at)
    values (p_workspace, p_created_at, p_signal_id, p_now)
  on conflict (workspace_id) do update
    set last_signal_created_at = excluded.last_signal_created_at,
        last_signal_id = excluded.last_signal_id,
        updated_at = excluded.updated_at
    where (trigger_scan_cursor.last_signal_created_at, trigger_scan_cursor.last_signal_id)
        < (excluded.last_signal_created_at, excluded.last_signal_id);
end $$;

-- Operational cursor reset: next scan re-initializes to the signal frontier.
create or replace function app_reset_trigger_cursor(p_workspace uuid)
  returns void language sql security definer set search_path = public as $$
  delete from trigger_scan_cursor where workspace_id = p_workspace;
$$;

revoke all on function app_claim_trigger_run(uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app_claim_trigger_run(uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz) to service_role;
revoke all on function app_advance_trigger_cursor(uuid, timestamptz, uuid, timestamptz) from public, anon, authenticated;
grant execute on function app_advance_trigger_cursor(uuid, timestamptz, uuid, timestamptz) to service_role;
revoke all on function app_reset_trigger_cursor(uuid) from public, anon, authenticated;
grant execute on function app_reset_trigger_cursor(uuid) to service_role;

-- Bounded, ordered signal scan after a (created_at, id) cursor for durable trigger
-- evaluation. Uses idx_signals_scan; hard-capped so a backlog can't unbound a tick.
create or replace function app_scan_signals_after(
  p_workspace uuid, p_created_at timestamptz, p_signal_id uuid, p_limit int
) returns setof signals language sql stable security definer set search_path = public as $$
  select * from signals
  where workspace_id = p_workspace
    and (
      p_created_at is null
      or created_at > p_created_at
      or (created_at = p_created_at and id > coalesce(p_signal_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by created_at asc, id asc
  limit greatest(0, least(coalesce(p_limit, 200), 1000));
$$;
revoke all on function app_scan_signals_after(uuid, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function app_scan_signals_after(uuid, timestamptz, uuid, int) to service_role;

-- Durable job queue with leasing.
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  scheduled_for timestamptz,
  attempts int not null default 0,
  max_attempts int not null default 3,
  lease_until timestamptz,
  lease_worker text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The claim scan: queued+due OR running+expired-lease, oldest first.
create index if not exists idx_jobs_claimable
  on jobs (coalesce(scheduled_for, created_at))
  where status in ('queued','running');

-- Validation probe (used by scripts/validation/validate-env.mjs): reports the
-- Postgres version, required extensions, and whether the schema is present, so
-- the fail-closed validator can assert the target DB is a real, ready validation
-- database. Read-only; service-role callable.
create or replace function app_validation_probe()
  returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', current_setting('server_version'),
    'has_pgcrypto', exists (select 1 from pg_extension where extname = 'pgcrypto'),
    'has_jobs_table', to_regclass('public.jobs') is not null,
    'has_claim_jobs', exists (select 1 from pg_proc where proname = 'claim_jobs'),
    'workspace_count', (select count(*) from workspaces)
  );
$$;

-- Atomic batch claim for the worker: queued+due OR running+expired-lease, oldest
-- first, locked with SKIP LOCKED so concurrent workers never claim the same job.
-- Each claim increments attempts and sets a fresh lease. Service-role only.
create or replace function claim_jobs(p_worker text, p_lease_ms int, p_now timestamptz, p_limit int)
  returns setof jobs
  language plpgsql security definer set search_path = public as $$
begin
  return query
  update jobs j set
    status = 'running',
    attempts = j.attempts + 1,
    lease_until = p_now + make_interval(secs => p_lease_ms / 1000.0),
    lease_worker = p_worker,
    updated_at = p_now
  where j.id in (
    select id from jobs c
    where (c.status = 'queued' and (c.scheduled_for is null or c.scheduled_for <= p_now))
       or (c.status = 'running' and c.lease_until is not null and c.lease_until < p_now)
    order by coalesce(c.scheduled_for, c.created_at)
    for update skip locked
    limit p_limit
  )
  returning j.*;
end;
$$;

-- ============================================================================
-- Sprint 7 Phase 1: durable schedule / timer / approval resume (D-666..D-670)
-- ============================================================================
-- Every function below is `security definer`, service-role-only, and does its
-- claim + run-create/mutation + job-enqueue in ONE statement/transaction, so an
-- at-least-once worker never strands a claim without its job (recoverable), never
-- double-fires (dedup on schedule_occurrences / workflow_timers.claimed_at /
-- trigger_claims), and is safe under concurrent workers + duplicate Cron.

-- Schedule occurrence claim: dedup on schedule_occurrences, then create exactly
-- one pending run + one workflow.run job. `p_occurrence_key` is server-derived
-- (version + trigger index + scheduled boundary); `p_trigger` carries the
-- scheduled-at causation. New root correlation is chosen by the caller per
-- occurrence. Mirrors app_claim_trigger_run but keyed on the schedule occurrence.
create or replace function app_claim_schedule_run(
  p_workspace uuid, p_workflow_id uuid, p_occurrence_key text, p_run_id uuid, p_version_id uuid,
  p_correlation_id uuid, p_trigger jsonb, p_variables jsonb, p_started_by uuid,
  p_job_kind text, p_now timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into schedule_occurrences (workspace_id, workflow_id, occurrence_key, fired_at)
    values (p_workspace, p_workflow_id, p_occurrence_key, p_now)
    on conflict (workspace_id, workflow_id, occurrence_key) do nothing;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  insert into workflow_runs (id, workspace_id, workflow_id, version_id, correlation_id,
      status, trigger, trigger_key, variables, frontier, join_arrivals, started_by, created_at, updated_at)
    values (p_run_id, p_workspace, p_workflow_id, p_version_id, p_correlation_id,
      'pending', p_trigger, p_occurrence_key, coalesce(p_variables, '{}'::jsonb), '{}', '{}', p_started_by, p_now, p_now);
  insert into jobs (workspace_id, kind, payload, status, created_at, updated_at)
    values (p_workspace, p_job_kind,
      jsonb_build_object('workspaceId', p_workspace, 'runId', p_run_id, 'versionId', p_version_id),
      'queued', p_now, p_now);
  return jsonb_build_object('claimed', true, 'run_id', p_run_id);
end $$;
revoke all on function app_claim_schedule_run(uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app_claim_schedule_run(uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz) to service_role;

-- Durable timer resume: atomically claim due, unclaimed timers whose run is
-- non-terminal (SKIP LOCKED, bounded) and enqueue exactly one workflow.resume job
-- each. Claim (claimed_at) + enqueue are one statement, so a crash leaves neither.
-- Overdue timers after downtime are simply still-due here. Returns claimed count.
create or replace function app_claim_due_timers(p_now timestamptz, p_limit int, p_job_kind text)
  returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with due as (
    select t.id from workflow_timers t
    join workflow_runs r on r.id = t.run_id
    where t.claimed_at is null and t.due_at <= p_now
      and r.status not in ('completed','failed','cancelled','timed_out')
    order by t.due_at
    for update of t skip locked
    limit greatest(0, least(coalesce(p_limit, 100), 500))
  ),
  claimed as (
    update workflow_timers t set claimed_at = p_now
    from due where t.id = due.id
    returning t.id, t.workspace_id, t.run_id
  ),
  enq as (
    insert into jobs (workspace_id, kind, payload, status, created_at, updated_at)
    select c.workspace_id, p_job_kind,
      jsonb_build_object('workspaceId', c.workspace_id, 'runId', c.run_id,
                         'cause', 'timer', 'causeId', c.id),
      'queued', p_now, p_now
    from claimed c
    returning 1
  )
  select count(*)::int into v_count from enq;
  return coalesce(v_count, 0);
end $$;
revoke all on function app_claim_due_timers(timestamptz, int, text) from public, anon, authenticated;
grant execute on function app_claim_due_timers(timestamptz, int, text) to service_role;

-- Approval resume claim (fast path from decideApproval): dedup on a stable
-- trigger_claims key, then enqueue exactly one workflow.resume job. Idempotent
-- under duplicate decision requests + the catch-up pass (same key).
create or replace function app_claim_approval_resume(
  p_workspace uuid, p_approval_id uuid, p_run_id uuid, p_job_kind text, p_now timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into trigger_claims (workspace_id, trigger_key, run_id, created_at)
    values (p_workspace, 'approval-resume:' || p_approval_id::text, p_run_id, p_now)
    on conflict (workspace_id, trigger_key) do nothing;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  insert into jobs (workspace_id, kind, payload, status, created_at, updated_at)
    values (p_workspace, p_job_kind,
      jsonb_build_object('workspaceId', p_workspace, 'runId', p_run_id,
                         'cause', 'approval', 'causeId', p_approval_id),
      'queued', p_now, p_now);
  return jsonb_build_object('claimed', true);
end $$;
revoke all on function app_claim_approval_resume(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app_claim_approval_resume(uuid, uuid, uuid, text, timestamptz) to service_role;

-- Approval-resume catch-up pass: decided approvals whose run still waits and that
-- have no resume claim yet (e.g. the deciding request crashed after persisting the
-- decision but before enqueuing). Claim + enqueue atomically, bounded, SKIP LOCKED.
create or replace function app_claim_due_approval_resumes(p_now timestamptz, p_limit int, p_job_kind text)
  returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with due as (
    select a.id, a.workspace_id, a.run_id from workflow_approvals a
    join workflow_runs r on r.id = a.run_id
    where a.status in ('approved','rejected')
      and r.status = 'waiting_approval'
      and not exists (
        select 1 from trigger_claims tc
        where tc.workspace_id = a.workspace_id
          and tc.trigger_key = 'approval-resume:' || a.id::text
      )
    order by a.decided_at
    for update of a skip locked
    limit greatest(0, least(coalesce(p_limit, 100), 500))
  ),
  claimed as (
    insert into trigger_claims (workspace_id, trigger_key, run_id, created_at)
    select d.workspace_id, 'approval-resume:' || d.id::text, d.run_id, p_now from due
    on conflict (workspace_id, trigger_key) do nothing
    returning workspace_id, run_id, trigger_key
  ),
  enq as (
    insert into jobs (workspace_id, kind, payload, status, created_at, updated_at)
    select c.workspace_id, p_job_kind,
      jsonb_build_object('workspaceId', c.workspace_id, 'runId', c.run_id,
                         'cause', 'approval', 'causeId', split_part(c.trigger_key, ':', 2)),
      'queued', p_now, p_now
    from claimed c
    returning 1
  )
  select count(*)::int into v_count from enq;
  return coalesce(v_count, 0);
end $$;
revoke all on function app_claim_due_approval_resumes(timestamptz, int, text) from public, anon, authenticated;
grant execute on function app_claim_due_approval_resumes(timestamptz, int, text) to service_role;

-- Aggregate durable-runtime health (never per-row; null/unknown where unmeasurable).
-- Read-only, service-role callable. Schedule backlog is null: interval schedules
-- fire only the most-recent occurrence, so there is no meaningful DB backlog count.
create or replace function app_durable_health(p_now timestamptz)
  returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'scheduleBacklog', null,
    'overdueTimers', (select count(*) from workflow_timers where claimed_at is null and due_at <= p_now),
    'oldestOverdueTimerMs', (
      select extract(epoch from (p_now - min(due_at))) * 1000
      from workflow_timers where claimed_at is null and due_at <= p_now
    ),
    'pendingApprovalResumes', (
      select count(*) from workflow_approvals a join workflow_runs r on r.id = a.run_id
      where a.status in ('approved','rejected') and r.status = 'waiting_approval'
        and not exists (select 1 from trigger_claims tc
          where tc.workspace_id = a.workspace_id and tc.trigger_key = 'approval-resume:' || a.id::text)
    ),
    'resumeQueueDepth', (select count(*) from jobs where kind = 'workflow.resume' and status = 'queued'),
    'oldestResumeJobMs', (
      select extract(epoch from (p_now - min(coalesce(scheduled_for, created_at)))) * 1000
      from jobs where kind = 'workflow.resume' and status = 'queued'
    )
  );
$$;
revoke all on function app_durable_health(timestamptz) from public, anon, authenticated;
grant execute on function app_durable_health(timestamptz) to service_role;

-- ============================================================================
-- Triggers: append-only, immutability, timestamps
-- ============================================================================

-- Append-only tables reject UPDATE + DELETE.
do $$
declare t text;
begin
  foreach t in array array['signals','signal_events','workflow_step_runs','execution_logs','trigger_claims','schedule_occurrences','operation_activity','agent_activity']
  loop
    execute format('drop trigger if exists trg_append_only on %I', t);
    execute format('create trigger trg_append_only before update or delete on %I for each row execute function app_forbid_mutation()', t);
  end loop;
end $$;

-- Immutable workflow versions reject UPDATE (delete cascades with the workflow).
drop trigger if exists trg_immutable_version on workflow_versions;
create trigger trg_immutable_version before update on workflow_versions
  for each row execute function app_forbid_update();

-- Auto updated_at on mutable rows.
do $$
declare t text;
begin
  foreach t in array array['operations','agents','workflows','workflow_runs','jobs']
  loop
    execute format('drop trigger if exists trg_touch on %I', t);
    execute format('create trigger trg_touch before update on %I for each row execute function app_touch_updated_at()', t);
  end loop;
end $$;

-- ============================================================================
-- Row Level Security (workspace isolation)
-- ============================================================================

-- Membership check used by every RLS policy. Defined here (not in the shared
-- helpers at the top) because it is a `language sql` function whose body is
-- validated at creation time and references `workspace_members`, which must
-- already exist.
create or replace function app_is_member(ws uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- Every tenant table: members can SELECT their workspace; writes go through the
-- server (service role bypasses RLS but always filters by workspace_id).
do $$
declare t text;
begin
  foreach t in array array[
    'operations','operation_activity','agents','agent_activity','agent_executions','execution_logs',
    'workflows','workflow_versions','workflow_runs','workflow_step_runs','workflow_approvals',
    'workflow_timers','signals','signal_events'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists p_select on %I', t);
    execute format('create policy p_select on %I for select using (app_is_member(workspace_id))', t);
  end loop;
end $$;

-- workspace_members: a user sees their own rows.
alter table workspace_members enable row level security;
drop policy if exists p_members on workspace_members;
create policy p_members on workspace_members for select using (user_id = auth.uid());

-- workspaces: a member sees their workspace.
alter table workspaces enable row level security;
drop policy if exists p_workspaces on workspaces;
create policy p_workspaces on workspaces for select using (app_is_member(id));

-- Infrastructure tables (jobs, trigger_claims, schedule_occurrences,
-- signal_subscriptions) are server/worker-only: RLS on, no anon/auth policy, so
-- only the service role (which bypasses RLS) can touch them.
do $$
declare t text;
begin
  foreach t in array array['jobs','trigger_claims','schedule_occurrences','signal_subscriptions','trigger_scan_cursor']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ============================================================================
-- Role privileges (grants)
-- ============================================================================
-- RLS above governs which ROWS are visible; these grants govern TABLE access per
-- Supabase role. Enabling RLS does not grant table privileges, and service_role's
-- BYPASSRLS does not either — without explicit grants every access is "permission
-- denied". Granted explicitly so the schema does not depend on ambient
-- default-privilege configuration (portable across CLI / psql / dashboard apply).
grant usage on schema public to anon, authenticated, service_role;

-- service_role runs the server-side repositories (and bypasses RLS): full DML.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- authenticated gets row-filtered SELECT on TENANT tables only; RLS restricts to
-- the caller's workspace. Infra tables (jobs, trigger_claims, schedule_occurrences,
-- signal_subscriptions) are deliberately omitted — they stay service-role-only.
grant select on
  workspaces, workspace_members, operations, operation_activity, agents,
  agent_activity, agent_executions, execution_logs, workflows, workflow_versions,
  workflow_runs, workflow_step_runs, workflow_approvals, workflow_timers,
  signals, signal_events
  to authenticated;
