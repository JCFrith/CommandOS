import { describe, expect, it } from 'vitest';

import type { Signal } from '@/lib/signals/types';
import type { Workflow, WorkflowVersion } from '@/lib/workflows/types';
import {
  type ClaimAndEnqueueInput,
  type ClaimOutcome,
  cursorAfter,
  DurableTriggerEvaluator,
  type DurableTriggerPort,
  signalMatchesVersion,
  type SignalCursor,
} from '@/services/workflows/durable-trigger-evaluator';

const WS = '00000000-0000-0000-0000-0000000000a1';
const WS2 = '00000000-0000-0000-0000-0000000000b1';

function version(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return {
    id: 'ver-1',
    workflowId: 'wf-1',
    workspaceId: WS,
    version: 1,
    nodes: [],
    edges: [],
    triggers: [{ type: 'signal', signalType: 'operation.created' }],
    variables: [],
    startNodeId: 'start',
    createdBy: 'u1',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    workspaceId: WS,
    name: 'w',
    description: null,
    status: 'active',
    currentVersionId: 'ver-1',
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

let seq = 0;
function signal(overrides: Partial<Signal> = {}): Signal {
  seq += 1;
  return {
    id: `sig-${seq}`,
    workspaceId: WS,
    type: 'operation.created',
    correlationId: `corr-${seq}`,
    parentId: null,
    actorId: null,
    actorName: null,
    source: 'operations',
    category: 'lifecycle',
    severity: 'info',
    title: 't',
    summary: 's',
    payload: {},
    tags: [],
    metadata: {},
    subjectType: null,
    subjectId: null,
    status: 'open',
    resolution: 'unresolved',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  } as Signal;
}

/** An in-memory port that records claims and lets a test seed signals/cursors. */
class FakePort implements DurableTriggerPort {
  claims: ClaimAndEnqueueInput[] = [];
  private duplicates = new Set<string>();
  cursors = new Map<string, SignalCursor>();
  advances: Array<{ workspaceId: string; to: SignalCursor }> = [];

  constructor(
    private readonly active: Workflow[],
    private readonly versions: Record<string, WorkflowVersion>,
    private readonly signals: Record<string, Signal[]>, // per-workspace, ordered
    duplicateSignalIds: string[] = [],
  ) {
    duplicateSignalIds.forEach((id) => this.duplicates.add(id));
  }

  now() {
    return '2026-08-03T00:00:00.000Z';
  }
  async listActiveWorkflows() {
    return this.active;
  }
  async getVersion(_ws: string, versionId: string) {
    return this.versions[versionId] ?? null;
  }
  async latestSignalPosition(ws: string): Promise<SignalCursor | null> {
    const list = this.signals[ws] ?? [];
    const last = list[list.length - 1];
    return last ? { createdAt: last.createdAt, id: last.id } : null;
  }
  async scanSignalsAfter(ws: string, cursor: SignalCursor | null, limit: number) {
    const list = this.signals[ws] ?? [];
    return list
      .filter((s) => cursorAfter({ createdAt: s.createdAt, id: s.id }, cursor))
      .slice(0, limit);
  }
  async readCursor(ws: string) {
    return this.cursors.get(ws) ?? null;
  }
  async advanceCursor(ws: string, to: SignalCursor) {
    this.cursors.set(ws, to);
    this.advances.push({ workspaceId: ws, to });
  }
  async claimAndEnqueueRun(input: ClaimAndEnqueueInput): Promise<ClaimOutcome> {
    this.claims.push(input);
    return this.duplicates.has(input.signalId) ? 'duplicate' : 'enqueued';
  }
}

describe('signalMatchesVersion', () => {
  it('matches a signal-triggered version in the same workspace', () => {
    expect(signalMatchesVersion(signal(), version())).toBe(true);
  });
  it('rejects a cross-workspace signal', () => {
    expect(signalMatchesVersion(signal({ workspaceId: WS2 }), version())).toBe(false);
  });
  it('rejects a non-matching signal type', () => {
    expect(signalMatchesVersion(signal({ type: 'agent.run' }), version())).toBe(false);
  });
  it('rejects a version with no signal trigger', () => {
    expect(
      signalMatchesVersion(
        signal(),
        version({ triggers: [{ type: 'schedule', intervalMs: 1000 }] }),
      ),
    ).toBe(false);
  });
});

describe('cursorAfter', () => {
  it('is true past a null cursor', () => {
    expect(cursorAfter({ createdAt: 't', id: 'a' }, null)).toBe(true);
  });
  it('breaks equal timestamps by id', () => {
    expect(cursorAfter({ createdAt: 't', id: 'b' }, { createdAt: 't', id: 'a' })).toBe(true);
    expect(cursorAfter({ createdAt: 't', id: 'a' }, { createdAt: 't', id: 'b' })).toBe(false);
  });
});

describe('DurableTriggerEvaluator.evaluateSignals', () => {
  it('first sight initializes the cursor to the frontier and does not match history', async () => {
    const s1 = signal({ id: 's1', createdAt: '2026-08-02T00:00:00.000Z' });
    const port = new FakePort([workflow()], { 'ver-1': version() }, { [WS]: [s1] });
    const r = await new DurableTriggerEvaluator(port).evaluateSignals();
    expect(r.initializedWorkspaces).toBe(1);
    expect(port.claims).toHaveLength(0); // no history replay
    expect(port.cursors.get(WS)).toEqual({ createdAt: s1.createdAt, id: 's1' });
  });

  it('after init, a matching signal is claimed+enqueued and the cursor advances', async () => {
    const s1 = signal({ id: 's1', createdAt: '2026-08-02T00:00:00.000Z' });
    const s2 = signal({ id: 's2', createdAt: '2026-08-02T00:00:01.000Z' });
    const port = new FakePort([workflow()], { 'ver-1': version() }, { [WS]: [s1, s2] });
    port.cursors.set(WS, { createdAt: s1.createdAt, id: 's1' }); // already initialized past s1
    const r = await new DurableTriggerEvaluator(port).evaluateSignals();
    expect(r.enqueued).toBe(1);
    expect(port.claims[0]!.signalId).toBe('s2');
    expect(port.claims[0]!.correlationId).toBe(s2.correlationId);
    expect(port.cursors.get(WS)).toEqual({ createdAt: s2.createdAt, id: 's2' });
  });

  it('skips workflow-emitted signals (self-trigger guard) but still advances the cursor', async () => {
    const s = signal({ id: 's1', source: 'workflows', createdAt: '2026-08-02T00:00:02.000Z' });
    const port = new FakePort([workflow()], { 'ver-1': version() }, { [WS]: [s] });
    port.cursors.set(WS, { createdAt: '2026-08-02T00:00:00.000Z', id: 's0' });
    const r = await new DurableTriggerEvaluator(port).evaluateSignals();
    expect(r.matched).toBe(0);
    expect(port.claims).toHaveLength(0);
    expect(port.cursors.get(WS)).toEqual({ createdAt: s.createdAt, id: 's1' }); // advanced past it
  });

  it('counts a duplicate claim as duplicate, not enqueued', async () => {
    const s = signal({ id: 'dup', createdAt: '2026-08-02T00:00:03.000Z' });
    const port = new FakePort([workflow()], { 'ver-1': version() }, { [WS]: [s] }, ['dup']);
    port.cursors.set(WS, { createdAt: '2026-08-02T00:00:00.000Z', id: 's0' });
    const r = await new DurableTriggerEvaluator(port).evaluateSignals();
    expect(r.matched).toBe(1);
    expect(r.enqueued).toBe(0);
    expect(r.duplicate).toBe(1);
  });

  it('ignores workspaces whose active workflow has no signal trigger', async () => {
    const wf = workflow({ currentVersionId: 'ver-sched' });
    const port = new FakePort(
      [wf],
      {
        'ver-sched': version({
          id: 'ver-sched',
          triggers: [{ type: 'schedule', intervalMs: 1000 }],
        }),
      },
      { [WS]: [signal()] },
    );
    const r = await new DurableTriggerEvaluator(port).evaluateSignals();
    expect(r.workspacesScanned).toBe(0);
    expect(port.claims).toHaveLength(0);
  });
});
