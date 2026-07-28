import { beforeEach, describe, expect, it } from 'vitest';

import { InProcessSignalBus } from '@/lib/signals/bus';
import type { Signal } from '@/lib/signals/types';
import { InMemoryWorkflowRepository } from '@/services/workflows/in-memory-workflow-repository';
import { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import type { WorkflowCapabilities } from '@/lib/workflows/runtime/ports';
import {
  WorkflowError,
  WorkflowService,
  type WorkflowContext,
} from '@/services/workflows/workflow-service';
import type { AuthUser, Workspace, WorkspaceRole } from '@/types';
import type { WorkflowDefinitionInput } from '@/lib/workflows/schema';

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
function ctxFor(role: WorkspaceRole = 'owner', workspaceId = 'ws-1'): WorkflowContext {
  const workspace: Workspace = { id: workspaceId, name: 'W', slug: 'w', role, kind: 'personal' };
  return { user, workspace };
}
const okCaps: WorkflowCapabilities = {
  runAgent: async () => ({ ok: true, summary: 'ok', output: {} }),
  createOperation: async () => ({ id: 'op-1' }),
  transitionOperation: async () => {},
};

const LINEAR: WorkflowDefinitionInput = {
  variables: [{ key: 'name', type: 'string', required: false, default: 'x' }],
  triggers: [{ type: 'manual' }],
  startNodeId: 's',
  nodes: [
    { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
    {
      id: 'v',
      type: 'set_variable',
      name: 'V',
      config: { type: 'set_variable', key: 'greeting', valueTemplate: 'hi {{name}}' },
    },
    { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
  ],
  edges: [
    { from: 's', to: 'v' },
    { from: 'v', to: 'e' },
  ],
};

let repo: InMemoryWorkflowRepository;
let bus: InProcessSignalBus;
let signals: Signal[];
let service: WorkflowService;

function deterministic() {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `id-${++ids}`,
    now: () => new Date(Date.UTC(2026, 6, 1) + ticks++ * 1000).toISOString(),
  };
}

beforeEach(() => {
  repo = new InMemoryWorkflowRepository();
  bus = new InProcessSignalBus();
  signals = [];
  bus.subscribe({}, (s) => void signals.push(s));
  const runtime = new WorkflowRuntime({
    ...deterministic(),
    publisher: bus,
    capabilities: okCaps,
    store: repo,
  });
  service = new WorkflowService(repo, runtime, bus, bus, deterministic());
});

describe('WorkflowService — definition lifecycle + versioning', () => {
  it('creates a draft and emits workflow.created', async () => {
    const wf = await service.create(ctxFor(), { name: 'Review' });
    expect(wf).toMatchObject({ status: 'draft', workspaceId: 'ws-1' });
    expect(signals.some((s) => s.type === 'workflow.created')).toBe(true);
  });

  it('publishes incrementing versions and updates the current version', async () => {
    const wf = await service.create(ctxFor(), { name: 'Review' });
    const v1 = await service.publish(ctxFor(), wf.id, LINEAR);
    const v2 = await service.publish(ctxFor(), wf.id, LINEAR);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect((await service.get(ctxFor(), wf.id)).currentVersionId).toBe(v2.id);
  });

  it('rejects an invalid definition', async () => {
    const wf = await service.create(ctxFor(), { name: 'Review' });
    await expect(
      service.publish(ctxFor(), wf.id, {
        nodes: [],
        edges: [],
        triggers: [],
        variables: [],
        startNodeId: 'x',
      }),
    ).rejects.toBeInstanceOf(WorkflowError);
  });

  it('requires a published version before activating', async () => {
    const wf = await service.create(ctxFor(), { name: 'Review' });
    await expect(service.transition(ctxFor(), wf.id, { to: 'active' })).rejects.toMatchObject({
      code: 'not_runnable',
    });
  });
});

describe('WorkflowService — running', () => {
  async function activeWorkflow() {
    const wf = await service.create(ctxFor(), { name: 'Review' });
    await service.publish(ctxFor(), wf.id, LINEAR);
    await service.transition(ctxFor(), wf.id, { to: 'active' });
    return wf;
  }

  it('runs a workflow manually to completion', async () => {
    const wf = await activeWorkflow();
    const run = await service.start(ctxFor(), wf.id, { name: 'Ada' });
    expect(run.status).toBe('completed');
    expect(run.variables.greeting).toBe('hi Ada');
    expect(signals.some((s) => s.type === 'workflow.run.completed')).toBe(true);
  });

  it('refuses to run a non-active workflow', async () => {
    const wf = await service.create(ctxFor(), { name: 'Review' });
    await service.publish(ctxFor(), wf.id, LINEAR);
    await expect(service.start(ctxFor(), wf.id, {})).rejects.toMatchObject({
      code: 'not_runnable',
    });
  });
});

describe('WorkflowService — workspace isolation', () => {
  it('cannot read a workflow from another workspace', async () => {
    const wf = await service.create(ctxFor('owner', 'ws-1'), { name: 'Review' });
    await expect(service.get(ctxFor('owner', 'ws-2'), wf.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
