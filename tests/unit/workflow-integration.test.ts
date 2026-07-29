import { beforeEach, describe, expect, it } from 'vitest';

import { InProcessSignalBus } from '@/lib/signals/bus';
import { InMemorySignalEventStore } from '@/lib/signals/store';
import { createSignal, emittedEvent } from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/platform/correlation';
import type { Signal } from '@/lib/signals/types';

import { InMemoryWorkflowRepository } from '@/services/workflows/in-memory-workflow-repository';
import { WorkflowRuntime } from '@/lib/workflows/runtime/runtime';
import type { WorkflowCapabilities } from '@/lib/workflows/runtime/ports';
import { WorkflowService, type WorkflowContext } from '@/services/workflows/workflow-service';
import type { WorkflowDefinitionInput } from '@/lib/workflows/schema';
import type { AuthUser, Workspace } from '@/types';

const user: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
function ctxFor(workspaceId = 'ws-1'): WorkflowContext {
  const workspace: Workspace = {
    id: workspaceId,
    name: 'W',
    slug: 'w',
    role: 'owner',
    kind: 'personal',
  };
  return { user, workspace };
}
const okCaps: WorkflowCapabilities = {
  runAgent: async () => ({ ok: true, summary: 'ok', output: {} }),
  createOperation: async () => ({ id: 'op-1' }),
  transitionOperation: async () => {},
};

function deterministic(prefix: string) {
  let ids = 0;
  let ticks = 0;
  return {
    id: () => `${prefix}-${++ids}`,
    now: () => new Date(Date.UTC(2026, 6, 1) + ticks++ * 1000).toISOString(),
  };
}

// A workflow triggered by `operation.created`, that emits a signal + ends.
const SIGNAL_TRIGGERED: WorkflowDefinitionInput = {
  variables: [],
  triggers: [{ type: 'signal', signalType: 'operation.created' }],
  startNodeId: 's',
  nodes: [
    { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
    {
      id: 'emit',
      type: 'emit_signal',
      name: 'Emit',
      config: {
        type: 'emit_signal',
        signalType: 'workflow.node.completed',
        summaryTemplate: 'reacted',
      },
    },
    { id: 'e', type: 'end', name: 'E', config: { type: 'end' } },
  ],
  edges: [
    { from: 's', to: 'emit' },
    { from: 'emit', to: 'e' },
  ],
};

const SCHEDULED: WorkflowDefinitionInput = {
  ...SIGNAL_TRIGGERED,
  triggers: [{ type: 'schedule', intervalMs: 60_000 }],
};

let repo: InMemoryWorkflowRepository;
let bus: InProcessSignalBus;
let store: InMemorySignalEventStore;
let signals: Signal[];
let service: WorkflowService;

beforeEach(() => {
  repo = new InMemoryWorkflowRepository();
  bus = new InProcessSignalBus();
  store = new InMemorySignalEventStore();
  signals = [];
  // Mirror the platform wiring: persist + collect every published signal.
  bus.subscribe({}, async (s) => {
    signals.push(s);
    await store.appendSignal(s);
    await store.appendEvent(emittedEvent(s));
  });
  const runtime = new WorkflowRuntime({
    ...deterministic('rt'),
    publisher: bus,
    capabilities: okCaps,
    store: repo,
  });
  service = new WorkflowService(repo, runtime, bus, bus, deterministic('sv'));
});

async function activate(def: WorkflowDefinitionInput) {
  const wf = await service.create(ctxFor(), { name: 'Auto' });
  await service.publish(ctxFor(), wf.id, def);
  await service.transition(ctxFor(), wf.id, { to: 'active' });
  return wf;
}

describe('Workflow integration — signal triggers', () => {
  it('starts and completes a run when a matching signal is published', async () => {
    const wf = await activate(SIGNAL_TRIGGERED);

    // Publish a triggering signal (as Operations would).
    await bus.publish(
      createSignal(
        {
          type: 'operation.created',
          workspaceId: 'ws-1',
          correlation: rootCorrelation('c'),
          summary: 'op',
          source: 'operations',
        },
        deterministic('op'),
      ),
    );
    // Allow the fire-and-forget trigger handler to settle.
    await new Promise((r) => setTimeout(r, 0));

    const runs = await service.listRuns(ctxFor(), wf.id);
    expect(runs.length).toBe(1);
    expect(runs[0]!.status).toBe('completed');
    expect(runs[0]!.trigger.type).toBe('signal');
  });

  it('does not self-trigger on its own workflow signals', async () => {
    const selfTrigger: WorkflowDefinitionInput = {
      ...SIGNAL_TRIGGERED,
      triggers: [{ type: 'signal', signalType: 'workflow.node.completed' }],
    };
    const wf = await activate(selfTrigger);
    // The workflow emits workflow.node.completed; it must NOT re-trigger itself.
    await bus.publish(
      createSignal(
        {
          type: 'operation.created',
          workspaceId: 'ws-1',
          correlation: rootCorrelation('c'),
          summary: 'x',
          source: 'operations',
        },
        deterministic('op'),
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    const runs = await service.listRuns(ctxFor(), wf.id);
    expect(runs.length).toBe(0); // never fired (trigger type didn't match a non-workflow source)
  });
});

describe('Workflow integration — scheduled triggers', () => {
  it('fires a scheduled workflow when its interval elapses', async () => {
    const wf = await activate(SCHEDULED);
    const fired = await service.runDueSchedules(1_000_000);
    expect(fired).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    const runs = await service.listRuns(ctxFor(), wf.id);
    expect(runs.length).toBe(1);
    expect(runs[0]!.trigger.type).toBe('schedule');
  });
});

describe('Workflow integration — signal-derived history + correlation', () => {
  it('reconstructs run history from Signals, all sharing the run correlation id', async () => {
    const wf = await activate(SIGNAL_TRIGGERED);
    await bus.publish(
      createSignal(
        {
          type: 'operation.created',
          workspaceId: 'ws-1',
          correlation: rootCorrelation('c'),
          summary: 'op',
          source: 'operations',
        },
        deterministic('op'),
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    const run = (await service.listRuns(ctxFor(), wf.id))[0]!;

    // History = signals about this run (subject = the run), not a bespoke table.
    const runSignals = await store.listSignals({ workspaceId: 'ws-1', subjectId: run.id });
    const types = runSignals.map((s) => s.type);
    expect(types).toContain('workflow.run.started');
    expect(types).toContain('workflow.run.completed');
    // Every run signal shares the run's correlation id.
    expect(new Set(runSignals.map((s) => s.correlationId))).toEqual(new Set([run.correlationId]));
  });
});
