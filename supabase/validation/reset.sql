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
    workflow_versions, workflows, trigger_claims, trigger_scan_cursor, schedule_occurrences, jobs,
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

-- Effective-role diagnostic (VALIDATION-ONLY). Reports the Postgres role the
-- CALLER's Supabase HTTP client actually resolves to, so the harness can prove
-- credential wiring BEFORE running the DB suites:
--   service-role key -> 'service_role',  anon key -> 'anon',  user JWT -> 'authenticated'
--
-- SECURITY INVOKER is load-bearing: it runs as the caller's PostgREST-assigned
-- role, so `current_user` is the effective role. (SECURITY DEFINER — as used by
-- app_validation_probe — would always report the definer and could not detect a
-- swapped/wrong key.) It reads only role identity: NO table access, NO secrets,
-- and it never touches app data, RLS, or the app's privilege model. It is
-- format-agnostic — it never decodes a JWT — so legacy JWT keys and the newer
-- sb_publishable_ / sb_secret_ keys are all classified by their real effect.
create or replace function app_effective_role()
  returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'db_role', current_user,
    'session_user', session_user,
    -- Best-effort echo of the JWT role claim (null when there is no JWT, e.g. a
    -- bare anon/service key). `current_user` above is the authoritative signal.
    'jwt_role', nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;
-- The diagnostic must be callable AS each of the three roles it distinguishes.
grant execute on function app_effective_role() to anon, authenticated, service_role;
