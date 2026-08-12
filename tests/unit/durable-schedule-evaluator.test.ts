import { describe, expect, it } from 'vitest';

import type { Workflow, WorkflowVersion } from '@/lib/workflows/types';
import type { ClaimOutcome } from '@/services/workflows/durable-trigger-evaluator';
import {
  DurableScheduleEvaluator,
  type DurableSchedulePort,
  mostRecentOccurrence,
  type ScheduleClaimInput,
} from '@/services/workflows/durable-schedule-evaluator';

const WS = '00000000-0000-0000-0000-0000000000a1';
const ANCHOR = '2026-08-01T00:00:00.000Z';
const ANCHOR_MS = Date.parse(ANCHOR);

function version(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return {
    id: 'ver-1',
    workflowId: 'wf-1',
    workspaceId: WS,
    version: 1,
    nodes: [],
    edges: [],
    triggers: [{ type: 'schedule', intervalMs: 60_000 }],
    variables: [],
    startNodeId: 'start',
    createdBy: 'u1',
    createdAt: ANCHOR,
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
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
    ...overrides,
  };
}

class FakeSchedulePort implements DurableSchedulePort {
  claims: ScheduleClaimInput[] = [];
  private seenKeys = new Set<string>();
  private corr = 0;

  constructor(
    private readonly active: Workflow[],
    private readonly versions: Record<string, WorkflowVersion>,
    private readonly nowIso: string,
  ) {}

  now() {
    return this.nowIso;
  }
  async listActiveWorkflows() {
    return this.active;
  }
  async getVersion(_ws: string, id: string) {
    return this.versions[id] ?? null;
  }
  newCorrelationId() {
    this.corr += 1;
    return `corr-${this.corr}`;
  }
  async claimScheduleRun(input: ScheduleClaimInput): Promise<ClaimOutcome> {
    this.claims.push(input);
    if (this.seenKeys.has(input.occurrenceKey)) return 'duplicate';
    this.seenKeys.add(input.occurrenceKey);
    return 'enqueued';
  }
}

describe('mostRecentOccurrence', () => {
  it('is null before the first interval elapses', () => {
    expect(mostRecentOccurrence(ANCHOR_MS, 60_000, ANCHOR_MS)).toBeNull();
    expect(mostRecentOccurrence(ANCHOR_MS, 60_000, ANCHOR_MS + 59_999)).toBeNull();
  });
  it('returns the exact boundary at the first interval', () => {
    expect(mostRecentOccurrence(ANCHOR_MS, 60_000, ANCHOR_MS + 60_000)).toBe(ANCHOR_MS + 60_000);
  });
  it('catches up to only the MOST RECENT boundary after many missed intervals', () => {
    // 10.5 intervals elapsed ⇒ the 10th boundary, never a backlog of 1..10.
    const now = ANCHOR_MS + 60_000 * 10 + 30_000;
    expect(mostRecentOccurrence(ANCHOR_MS, 60_000, now)).toBe(ANCHOR_MS + 60_000 * 10);
  });
  it('is null for a non-positive interval', () => {
    expect(mostRecentOccurrence(ANCHOR_MS, 0, ANCHOR_MS + 10_000)).toBeNull();
  });
});

describe('DurableScheduleEvaluator.evaluateSchedules', () => {
  it('claims exactly one run for the most-recent occurrence with a stable identity', async () => {
    const now = new Date(ANCHOR_MS + 60_000 * 3 + 5_000).toISOString();
    const port = new FakeSchedulePort([workflow()], { 'ver-1': version() }, now);
    const r = await new DurableScheduleEvaluator(port).evaluateSchedules();
    expect(r).toMatchObject({ workflowsScanned: 1, due: 1, enqueued: 1, duplicate: 0 });
    expect(port.claims).toHaveLength(1);
    expect(port.claims[0]!.occurrenceKey).toBe(`ver-1:sched0:${ANCHOR_MS + 60_000 * 3}`);
    expect(port.claims[0]!.scheduledAt).toBe(new Date(ANCHOR_MS + 60_000 * 3).toISOString());
    expect(port.claims[0]!.correlationId).toBe('corr-1'); // fresh root per occurrence
  });

  it('is idempotent across passes: the same occurrence is a duplicate the second time', async () => {
    const now = new Date(ANCHOR_MS + 60_000 * 2 + 1).toISOString();
    const port = new FakeSchedulePort([workflow()], { 'ver-1': version() }, now);
    const ev = new DurableScheduleEvaluator(port);
    const first = await ev.evaluateSchedules();
    const second = await ev.evaluateSchedules();
    expect(first.enqueued).toBe(1);
    expect(second.enqueued).toBe(0);
    expect(second.duplicate).toBe(1);
  });

  it('does not fire before the first interval', async () => {
    const now = new Date(ANCHOR_MS + 30_000).toISOString();
    const port = new FakeSchedulePort([workflow()], { 'ver-1': version() }, now);
    const r = await new DurableScheduleEvaluator(port).evaluateSchedules();
    expect(r.due).toBe(0);
    expect(port.claims).toHaveLength(0);
  });

  it('ignores workflows whose current version has no schedule trigger', async () => {
    const now = new Date(ANCHOR_MS + 60_000 * 5).toISOString();
    const port = new FakeSchedulePort(
      [workflow()],
      { 'ver-1': version({ triggers: [{ type: 'signal', signalType: 'x' }] }) },
      now,
    );
    const r = await new DurableScheduleEvaluator(port).evaluateSchedules();
    expect(r.workflowsScanned).toBe(0);
    expect(port.claims).toHaveLength(0);
  });
});
