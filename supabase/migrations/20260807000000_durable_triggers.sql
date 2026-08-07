-- ============================================================================
-- Sprint 7 Phase 1 — Durable triggers / schedules / timers / approval resume
-- ============================================================================
-- Timestamp 20260807000000 places this migration STRICTLY AFTER the released
-- v0.6.5/v0.6.6 production-foundation migration (20260729000000), which is now
-- immutable. Everything below is a NET-NEW addition on top of the v0.6.6 schema:
--
--   * an empty DB applies 20260729000000 then this file and reaches the Sprint 7
--     schema;
--   * a DB already at v0.6.6 applies ONLY this file and reaches the same schema.
--
-- Nothing here re-defines a pre-Sprint-7 object except the `workflow_timers`
-- ALTERs (adding the resume `node_id` + its idempotency constraint), which are
-- guarded with `if not exists` / `if exists` so re-apply is a no-op.
--
-- Privilege model (see the block at the end): every SECURITY DEFINER RPC added
-- here is server-only — `revoke all from public, anon, authenticated` then
-- `grant execute to service_role`. The one new table (`trigger_scan_cursor`) is
-- infrastructure: RLS-enabled with no policies, granted only to service_role.
-- These statements are self-contained in THIS migration because the v0.6.6
-- `grant all on all tables ... to service_role` ran before these objects
-- existed and therefore does not cover them.

-- ----------------------------------------------------------------------------
-- Schema: durable trigger-scan progress + resume `node_id`
-- ----------------------------------------------------------------------------

-- Durable trigger-scan progress. One row per workspace marks how far the worker
-- has scanned `signals` for signal-trigger evaluation. It is a progress marker /
-- optimization, NOT the deduplication mechanism — `trigger_claims` is
-- authoritative (D-665). Advancement is monotonic (`created_at ASC, id ASC`), so
-- concurrent scans are redundant but never lose work.
create table if not exists trigger_scan_cursor (
  workspace_id uuid primary key,
  last_signal_created_at timestamptz not null default 'epoch',
  last_signal_id uuid,
  updated_at timestamptz not null default now()
);
-- Ordered signal scan for trigger evaluation: workspace-scoped, (created_at, id) ASC.
create index if not exists idx_signals_scan on signals (workspace_id, created_at, id);

-- Resume `node_id` for delay-node timers. `node_id` pins the suspended delay node
-- so a resume re-advances the right frontier; `unique (run_id, node_id)` makes
-- timer creation idempotent (a re-suspension on the same node upserts, never
-- duplicates). v0.6.6 created `workflow_timers` without these, so add them here.
alter table workflow_timers add column if not exists node_id text not null default '';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workflow_timers_run_id_node_id_key'
  ) then
    alter table workflow_timers add constraint workflow_timers_run_id_node_id_key
      unique (run_id, node_id);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- RPCs: durable signal-trigger evaluation (D-665/D-666)
-- ----------------------------------------------------------------------------

-- Atomic claim → create run → enqueue (D-666). One transaction so a crash can
-- never leave a claimed occurrence stranded without a run+job. Idempotent:
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

-- ----------------------------------------------------------------------------
-- RPCs: durable schedule / timer / approval resume (D-666..D-670)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Row-level security for the new infrastructure table
-- ----------------------------------------------------------------------------
-- `trigger_scan_cursor` is infrastructure (like jobs / trigger_claims /
-- schedule_occurrences): RLS enabled with NO policies, so no browser role can see
-- or mutate it. service_role reaches it via the explicit grant below + BYPASSRLS.
alter table trigger_scan_cursor enable row level security;

-- ----------------------------------------------------------------------------
-- Role privileges (grants) — self-contained; explicit; ordered
-- ----------------------------------------------------------------------------
-- The v0.6.6 `grant all on all tables in schema public to service_role` ran
-- BEFORE these objects existed, so it does not cover them. Grant the new infra
-- table to service_role here (and to NOBODY else). Do NOT add it to the
-- `authenticated` SELECT set — it is server-only.
grant all on trigger_scan_cursor to service_role;

-- Every RPC added by this migration is a server-only SECURITY DEFINER function.
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on newly-created public
-- functions to anon + authenticated, so revoking from PUBLIC alone is not enough:
-- revoke from public AND anon AND authenticated, then grant only to service_role.
-- Ordering matters — the revoke must precede/stand independent of the grant so a
-- later broad grant cannot silently re-open these to browser roles.
revoke all on function app_claim_trigger_run(uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app_claim_trigger_run(uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz) to service_role;

revoke all on function app_advance_trigger_cursor(uuid, timestamptz, uuid, timestamptz) from public, anon, authenticated;
grant execute on function app_advance_trigger_cursor(uuid, timestamptz, uuid, timestamptz) to service_role;

revoke all on function app_reset_trigger_cursor(uuid) from public, anon, authenticated;
grant execute on function app_reset_trigger_cursor(uuid) to service_role;

revoke all on function app_scan_signals_after(uuid, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function app_scan_signals_after(uuid, timestamptz, uuid, int) to service_role;

revoke all on function app_claim_schedule_run(uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app_claim_schedule_run(uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz) to service_role;

revoke all on function app_claim_due_timers(timestamptz, int, text) from public, anon, authenticated;
grant execute on function app_claim_due_timers(timestamptz, int, text) to service_role;

revoke all on function app_claim_approval_resume(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app_claim_approval_resume(uuid, uuid, uuid, text, timestamptz) to service_role;

revoke all on function app_claim_due_approval_resumes(timestamptz, int, text) from public, anon, authenticated;
grant execute on function app_claim_due_approval_resumes(timestamptz, int, text) to service_role;

revoke all on function app_durable_health(timestamptz) from public, anon, authenticated;
grant execute on function app_durable_health(timestamptz) to service_role;

-- Forward-only hardening of a pre-Sprint-7 infrastructure RPC. v0.6.6 created the
-- job-lease function `claim_jobs()` as SECURITY DEFINER WITHOUT an explicit grant,
-- so it silently inherited the ambient default EXECUTE for PUBLIC/anon/authenticated
-- — meaning a browser role could lease worker jobs. The v0.6.6 migration is
-- released and immutable, so the fix lands HERE: lock `claim_jobs` to service_role
-- like every other infrastructure RPC. (The Sprint 7 rollback deliberately does NOT
-- re-loosen it — reverting a privilege fix would reintroduce the hole.)
revoke all on function claim_jobs(text, int, timestamptz, int) from public, anon, authenticated;
grant execute on function claim_jobs(text, int, timestamptz, int) to service_role;
