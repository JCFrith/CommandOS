-- VALIDATION-ONLY helpers. NOT part of the canonical app schema — applied only by
-- the validation workflow against a disposable/local validation database, AFTER
-- the migrations. Never applied to production.
--
-- `app_reset_validation()` TRUNCATEs every table so integration suites start from
-- a known state. TRUNCATE fires no per-row trigger, so it works on the append-only
-- tables (whose triggers guard UPDATE/DELETE only) without weakening them.

create or replace function app_reset_validation()
  returns void language plpgsql security definer set search_path = public as $$
begin
  truncate
    operation_activity, operations, agent_activity, agent_executions, agents,
    execution_logs, signal_events, signals, signal_subscriptions,
    workflow_step_runs, workflow_approvals, workflow_timers, workflow_runs,
    workflow_versions, workflows, trigger_claims, schedule_occurrences, jobs,
    workspace_members, workspaces
  restart identity cascade;
end;
$$;

-- Seed a validation workspace + members with known ids for RLS/identity tests.
create or replace function app_seed_validation()
  returns void language plpgsql security definer set search_path = public as $$
begin
  insert into workspaces (id, name, slug, kind) values
    ('00000000-0000-0000-0000-00000000a001', 'Tenant A', 'a', 'team'),
    ('00000000-0000-0000-0000-00000000b001', 'Tenant B', 'b', 'team')
  on conflict do nothing;
  insert into workspace_members (workspace_id, user_id, role) values
    ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000a0001', 'owner'),
    ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000a0002', 'member'),
    ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000b0001', 'owner')
  on conflict do nothing;
end;
$$;
