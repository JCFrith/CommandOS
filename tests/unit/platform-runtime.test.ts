import { describe, expect, it } from 'vitest';

import { newId, newCorrelationId } from '@/lib/platform/ids';
import { rootCorrelation, continueChain, childRef } from '@/lib/platform/correlation';
import {
  canTransition,
  isTerminalStatus,
  TERMINAL_STATUSES,
  type ExecutionStatus,
} from '@/lib/platform/execution';
import type { Job, NewJob } from '@/lib/platform/background';

describe('platform/ids', () => {
  it('mints unique ids and aliases share the generator', () => {
    const a = newId();
    const b = newCorrelationId();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/[0-9a-f-]{36}/i);
  });
});

describe('platform/correlation', () => {
  it('roots a chain with no parent', () => {
    expect(rootCorrelation('c1')).toEqual({ correlationId: 'c1', parentId: null });
  });

  it('continues a chain, optionally under a parent', () => {
    expect(continueChain('c1')).toEqual({ correlationId: 'c1', parentId: null });
    expect(continueChain('c1', 'p1')).toEqual({ correlationId: 'c1', parentId: 'p1' });
  });

  it('derives a child from any { id, correlationId } record', () => {
    expect(childRef({ id: 'x', correlationId: 'c1' })).toEqual({
      correlationId: 'c1',
      parentId: 'x',
    });
  });
});

describe('platform/execution status machine', () => {
  it('allows only lawful transitions', () => {
    expect(canTransition('queued', 'pending')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'timed_out')).toBe(true);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('queued', 'completed')).toBe(false);
  });

  it('identifies terminal statuses', () => {
    for (const s of TERMINAL_STATUSES) expect(isTerminalStatus(s)).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    // Terminal statuses have no outgoing transitions.
    const terminal: ExecutionStatus = 'completed';
    expect(canTransition(terminal, 'failed')).toBe(false);
  });
});

describe('platform/background (generic, AI-agnostic contracts)', () => {
  it('a Job wraps an arbitrary payload with a kind — not an AI ExecutionRequest', () => {
    // Compile-level proof that any runtime can produce a job payload.
    const workflowJob: NewJob<{ workflowRunId: string }> = {
      workspaceId: 'ws-1',
      kind: 'workflow.run',
      payload: { workflowRunId: 'run-1' },
    };
    const stored: Job<{ workflowRunId: string }> = {
      id: 'job-1',
      workspaceId: workflowJob.workspaceId,
      kind: workflowJob.kind,
      payload: workflowJob.payload,
      status: 'queued',
      scheduledFor: null,
      attempts: 0,
      error: null,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    };
    expect(stored.kind).toBe('workflow.run');
    expect(stored.payload.workflowRunId).toBe('run-1');
  });
});
