-- Rollback for 20260729000000_production_foundation.sql
-- Drops every object the forward migration created, in dependency order.
-- Safe to run repeatedly (IF EXISTS).

drop table if exists workflow_approvals cascade;
drop table if exists workflow_step_runs cascade;
drop table if exists workflow_timers cascade;
drop table if exists workflow_runs cascade;
drop table if exists workflow_versions cascade;
drop table if exists workflows cascade;
drop table if exists schedule_occurrences cascade;
drop table if exists trigger_scan_cursor cascade;
drop table if exists trigger_claims cascade;
drop table if exists jobs cascade;
drop table if exists signal_events cascade;
drop table if exists signal_subscriptions cascade;
drop table if exists signals cascade;
drop table if exists execution_logs cascade;
drop table if exists agent_executions cascade;
drop table if exists agent_activity cascade;
drop table if exists agents cascade;
drop table if exists operation_activity cascade;
drop table if exists operations cascade;
drop table if exists workspace_members cascade;
drop table if exists workspaces cascade;

drop function if exists app_claim_trigger_run(uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz);
drop function if exists app_advance_trigger_cursor(uuid, timestamptz, uuid, timestamptz);
drop function if exists app_reset_trigger_cursor(uuid);
drop function if exists app_provision_personal_workspace(uuid, text);
drop function if exists app_is_member(uuid);
drop function if exists app_forbid_mutation();
drop function if exists app_forbid_update();
drop function if exists app_touch_updated_at();
