import { describe, expect, it } from 'vitest';

import { canTransition, isTerminalStatus, type Execution } from '@/lib/ai/runtime/execution';
import { toExecutionLog } from '@/lib/ai/runtime/logging';

describe('execution status state machine', () => {
  it('permits the queued → pending → running → terminal path', () => {
    expect(canTransition('queued', 'pending')).toBe(true);
    expect(canTransition('pending', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'timed_out')).toBe(true);
    expect(canTransition('running', 'cancelled')).toBe(true);
  });

  it('forbids skipping states and leaving terminal states', () => {
    expect(canTransition('queued', 'completed')).toBe(false);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('timed_out')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
  });
});

describe('execution log projection (secret-free)', () => {
  it('captures audit fields and a safe error, never payloads or secrets', () => {
    const execution: Execution<{ ok: boolean }> = {
      id: 'e-1',
      requestId: 'r-1',
      kind: 'synchronous',
      context: {
        workspaceId: 'ws-1',
        operatorId: 'u-1',
        operatorName: 'Ada',
        subjectId: 'a-1',
        subjectType: 'agent',
      },
      status: 'failed',
      result: null,
      error: {
        code: 'provider_failed',
        catalogCode: 'CMD-AI-002',
        message: 'safe message',
        retryable: true,
      },
      metadata: {
        provider: 'fake',
        model: 'fake-model',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: true },
        cost: { currency: 'USD', amount: 0, estimated: true },
        latencyMs: 5,
        attempts: 2,
        promptVersion: 'v1',
        toolCalls: 0,
      },
      events: [{ at: '2026-01-01T00:00:00.000Z', type: 'failed', status: 'failed' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
    };
    const log = toExecutionLog(execution);
    expect(log).toMatchObject({
      executionId: 'e-1',
      workspaceId: 'ws-1',
      operatorId: 'u-1',
      provider: 'fake',
      model: 'fake-model',
      status: 'failed',
      attempts: 2,
      error: 'safe message',
    });
    // No prompt/content/credential fields exist on the log shape.
    expect(JSON.stringify(log)).not.toContain('apiKey');
  });
});
