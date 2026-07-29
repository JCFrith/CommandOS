import { describe, expect, it } from 'vitest';

import { describeJobStoreContract } from '../unit/support/job-store-contract';
import { SupabaseLeasedJobStore } from '@/services/jobs/supabase-job-store';
import { SupabaseOperationsRepository } from '@/services/operations/supabase-operations-repository';
import { SupabaseWorkflowRepository } from '@/services/workflows/supabase-workflow-repository';
import { resetDb, testDb, WS_A, WS_B } from './helpers';
import { PRODUCTION_VALIDATION } from './setup';

/**
 * Adapter contract validation — the SAME behavioral contracts as the in-memory
 * suites, run against real Postgres. Registered only in production-validation mode
 * (setup fails closed if the DB is absent), so it is never silently skipped when
 * validation is requested.
 */
if (PRODUCTION_VALIDATION) {
  // The leased-job-store contract, verbatim, against Postgres (reset per assertion).
  describeJobStoreContract(
    'Supabase',
    () => new SupabaseLeasedJobStore(),
    async () => {
      await resetDb();
    },
  );

  describe('OperationsRepository contract — Supabase', () => {
    it('CRUD + workspace isolation + append-only chronological activity', async () => {
      await resetDb();
      const repo = new SupabaseOperationsRepository();
      const now = '2026-08-01T00:00:00.000Z';
      const op = {
        id: '00000000-0000-0000-0000-00000000000a',
        workspaceId: WS_A,
        title: 't',
        description: null,
        status: 'draft' as const,
        priority: 'medium' as const,
        createdBy: '00000000-0000-0000-0000-0000000a0001',
        updatedBy: '00000000-0000-0000-0000-0000000a0001',
        createdAt: now,
        updatedAt: now,
      };
      await repo.create(op);
      expect(await repo.getById(WS_A, op.id)).not.toBeNull();
      expect(await repo.getById(WS_B, op.id)).toBeNull(); // isolation
      await repo.update({ ...op, title: 'renamed' });
      expect((await repo.getById(WS_A, op.id))!.title).toBe('renamed');

      const act = (id: string) => ({
        id,
        operationId: op.id,
        workspaceId: WS_A,
        actorId: op.createdBy,
        actorName: 'Ada',
        type: 'created' as const,
        message: 'x',
        fromStatus: null,
        toStatus: null,
        createdAt: now,
      });
      await repo.appendActivity(act('00000000-0000-0000-0000-0000000000a1'));
      await repo.appendActivity(act('00000000-0000-0000-0000-0000000000a2'));
      const list = await repo.listActivity(WS_A, op.id);
      expect(list.map((a) => a.id)).toEqual([
        '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2',
      ]);

      // Append-only: a raw UPDATE/DELETE on activity must be rejected by the DB.
      const { error: upErr } = await testDb()
        .from('operation_activity')
        .update({ message: 'y' })
        .eq('id', '00000000-0000-0000-0000-0000000000a1');
      expect(upErr, 'operation_activity UPDATE must be rejected (append-only)').not.toBeNull();
    });
  });

  describe('WorkflowRepository contract — Supabase', () => {
    it('immutable versions reject UPDATE; trigger claim is atomic', async () => {
      await resetDb();
      const repo = new SupabaseWorkflowRepository();
      const now = '2026-08-01T00:00:00.000Z';
      const wf = {
        id: '00000000-0000-0000-0000-0000000000b0',
        workspaceId: WS_A,
        name: 'w',
        description: null,
        status: 'draft' as const,
        currentVersionId: null,
        createdBy: '00000000-0000-0000-0000-0000000a0001',
        updatedBy: '00000000-0000-0000-0000-0000000a0001',
        createdAt: now,
        updatedAt: now,
      };
      await repo.createWorkflow(wf);
      const ver = {
        id: '00000000-0000-0000-0000-0000000000b1',
        workflowId: wf.id,
        workspaceId: WS_A,
        version: 1,
        nodes: [{ id: 's', type: 'start', name: 'S', config: { type: 'start' } }],
        edges: [],
        triggers: [],
        variables: [],
        startNodeId: 's',
        createdBy: wf.createdBy,
        createdAt: now,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await repo.createVersion(ver as any);
      const { error: verErr } = await testDb()
        .from('workflow_versions')
        .update({ version: 2 })
        .eq('id', ver.id);
      expect(verErr, 'workflow_versions UPDATE must be rejected (immutable)').not.toBeNull();

      const a = await repo.claimTrigger({
        workspaceId: WS_A,
        triggerKey: 'k1',
        runId: 'r1',
        createdAt: now,
      });
      const b = await repo.claimTrigger({
        workspaceId: WS_A,
        triggerKey: 'k1',
        runId: 'r2',
        createdAt: now,
      });
      expect(a.claimed).toBe(true);
      expect(b).toEqual({ claimed: false, existingRunId: 'r1' });
    });
  });
} else {
  describe.skip('Supabase adapter contracts (requires PRODUCTION_VALIDATION + DB)', () => {
    it('skipped without a database', () => {});
  });
}
