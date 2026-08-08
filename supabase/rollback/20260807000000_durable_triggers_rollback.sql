-- ============================================================================
-- Rollback for 20260807000000_durable_triggers.sql (Sprint 7 Phase 1)
-- ============================================================================
-- Reverses ONLY the Sprint 7 durable-trigger additions, leaving the released
-- v0.6.6 production-foundation schema intact. Applying this to a Sprint 7 DB must
-- yield a schema byte-identical (modulo privileges, which pg_dump omits in the
-- reversibility check) to v0.6.6. Every statement is guarded so re-applying the
-- rollback is a no-op. This rollback must NEVER touch pre-Sprint-7 objects other
-- than reverting the `workflow_timers` ALTERs it introduced.

-- Server-only RPCs (drop before the objects they read, though `if exists` makes
-- order immaterial).
drop function if exists app_durable_health(timestamptz);
drop function if exists app_claim_due_approval_resumes(timestamptz, int, text);
drop function if exists app_claim_approval_resume(uuid, uuid, uuid, text, timestamptz);
drop function if exists app_claim_due_timers(timestamptz, int, text);
drop function if exists app_claim_schedule_run(uuid, uuid, text, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz);
drop function if exists app_scan_signals_after(uuid, timestamptz, uuid, int);
drop function if exists app_reset_trigger_cursor(uuid);
drop function if exists app_advance_trigger_cursor(uuid, timestamptz, uuid, timestamptz);
drop function if exists app_claim_trigger_run(uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, text, timestamptz);

-- Revert the workflow_timers resume additions back to the v0.6.6 shape.
alter table workflow_timers drop constraint if exists workflow_timers_run_id_node_id_key;
alter table workflow_timers drop column if exists node_id;

-- Durable trigger-scan progress (drops its RLS + service_role grant with it).
drop index if exists idx_signals_scan;
drop table if exists trigger_scan_cursor cascade;
