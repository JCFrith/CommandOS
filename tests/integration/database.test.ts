import { describe, expect, it } from 'vitest';

import { testDb } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

/**
 * Database/schema shape assertions against the migrated validation database.
 * These confirm the canonical migration produced the objects the app depends on
 * — extensions, core tables, the claim RPC — before any behavioral suite runs.
 */
(PRODUCTION_VALIDATION ? describe : describe.skip)('database schema', () => {
  it('the migration produced the expected server-side probe result', async () => {
    const { data, error } = await testDb().rpc('app_validation_probe');
    expect(error).toBeNull();
    const probe = data as {
      version: string;
      has_pgcrypto: boolean;
      has_jobs_table: boolean;
      has_claim_jobs: boolean;
    };
    expect(probe.has_pgcrypto, 'pgcrypto extension must be installed').toBe(true);
    expect(probe.has_jobs_table, 'jobs table must exist').toBe(true);
    expect(probe.has_claim_jobs, 'claim_jobs RPC must exist').toBe(true);
    const major = Number.parseInt(probe.version.split('.')[0] ?? '0', 10);
    expect(major, 'Postgres must be >= 14').toBeGreaterThanOrEqual(14);
  });

  it('every core table is present and reachable by the service role', async () => {
    const tables = [
      'workspaces',
      'workspace_members',
      'operations',
      'operation_activity',
      'agents',
      'agent_activity',
      'agent_executions',
      'execution_logs',
      'signals',
      'signal_events',
      'signal_subscriptions',
      'workflows',
      'workflow_versions',
      'workflow_runs',
      'workflow_step_runs',
      'workflow_approvals',
      'workflow_timers',
      'trigger_claims',
      'schedule_occurrences',
      'jobs',
    ];
    for (const table of tables) {
      const { error } = await testDb().from(table).select('*').limit(0);
      expect(error, `table ${table} must exist`).toBeNull();
    }
  });
});
