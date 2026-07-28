import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ExecutionRuntime } from '@/lib/ai/runtime/runtime';
import { FakeModelProvider } from '@/lib/ai/provider/fake';
import { ProviderError } from '@/lib/ai/provider/provider';
import { createConversation, systemPrompt, userInput } from '@/lib/ai/conversation/conversation';
import { createCancellation } from '@/lib/platform/cancellation';
import { NO_RETRY, fixedRetry } from '@/lib/platform/retry';
import type { ExecutionLog, ExecutionLogger } from '@/lib/ai/runtime/logging';
import type { ExecutionRequest } from '@/lib/ai/runtime/execution';

const schema = z.object({ value: z.number() });
type Out = z.infer<typeof schema>;

function capturingLogger(): { logger: ExecutionLogger; logs: ExecutionLog[] } {
  const logs: ExecutionLog[] = [];
  return {
    logs,
    logger: { record: async (l) => void logs.push(l), listByWorkspace: async () => logs },
  };
}

function makeRequest(overrides: Partial<ExecutionRequest<Out>> = {}): ExecutionRequest<Out> {
  return {
    id: 'r-1',
    kind: 'synchronous',
    context: {
      workspaceId: 'ws-1',
      operatorId: 'u-1',
      operatorName: 'Ada',
      subjectId: 'a-1',
      subjectType: 'agent',
    },
    conversation: createConversation(systemPrompt('sys', 'v1'), userInput('go')),
    outputSchema: schema,
    outputSpec: { name: 'out', schema: { type: 'object' } },
    retryPolicy: NO_RETRY,
    timeoutMs: 5_000,
    metadata: { promptVersion: 'v1' },
    ...overrides,
  };
}

function runtimeWith(provider: FakeModelProvider) {
  const { logger, logs } = capturingLogger();
  const runtime = new ExecutionRuntime(provider, { sleep: async () => {}, logger });
  return { runtime, logs };
}

describe('ExecutionRuntime — lifecycle & structured output', () => {
  it('completes, validating structured output and recording metadata + events + log', async () => {
    const { runtime, logs } = runtimeWith(new FakeModelProvider({ content: '{"value":42}' }));
    const exec = await runtime.run(makeRequest());

    expect(exec.status).toBe('completed');
    expect(exec.result?.output).toEqual({ value: 42 });
    expect(exec.metadata.provider).toBe('fake');
    expect(exec.metadata.model).toBe('fake-model');
    expect(exec.metadata.usage.totalTokens).toBeGreaterThan(0);
    expect(exec.metadata.cost.currency).toBe('USD');
    expect(exec.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    expect(exec.metadata.promptVersion).toBe('v1');
    expect(exec.events.map((e) => e.type)).toContain('completed');
    expect(exec.context.workspaceId).toBe('ws-1');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe('completed');
  });

  it('fails with invalid_output when the response does not match the schema', async () => {
    const { runtime } = runtimeWith(new FakeModelProvider({ content: '{"value":"not a number"}' }));
    const exec = await runtime.run(makeRequest());
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('invalid_output');
    expect(exec.result).toBeNull();
  });

  it('fails with invalid_output on non-JSON content', async () => {
    const { runtime } = runtimeWith(new FakeModelProvider({ content: 'not json' }));
    const exec = await runtime.run(makeRequest());
    expect(exec.error?.code).toBe('invalid_output');
  });
});

describe('ExecutionRuntime — retry', () => {
  it('retries a retryable provider error then succeeds, counting attempts', async () => {
    const provider = new FakeModelProvider({
      content: '{"value":1}',
      failWith: new ProviderError('failed', 'CMD-AI-002', 'transient', true),
      failTimes: 1,
    });
    const { runtime } = runtimeWith(provider);
    const exec = await runtime.run(makeRequest({ retryPolicy: fixedRetry(3, 1) }));
    expect(exec.status).toBe('completed');
    expect(exec.metadata.attempts).toBe(2);
    expect(exec.events.some((e) => e.type === 'retrying')).toBe(true);
  });

  it('exhausts retries then fails as provider_failed', async () => {
    const provider = new FakeModelProvider({
      failWith: new ProviderError('failed', 'CMD-AI-002', 'boom', true),
    });
    const { runtime } = runtimeWith(provider);
    const exec = await runtime.run(makeRequest({ retryPolicy: fixedRetry(3, 1) }));
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('provider_failed');
    expect(exec.metadata.attempts).toBe(3);
  });
});

describe('ExecutionRuntime — timeout & cancellation', () => {
  it('times out a slow provider (distinct timed_out status)', async () => {
    const { runtime } = runtimeWith(
      new FakeModelProvider({ content: '{"value":1}', latencyMs: 1_000 }),
    );
    const exec = await runtime.run(makeRequest({ timeoutMs: 10 }));
    expect(exec.status).toBe('timed_out');
    expect(exec.error?.code).toBe('timeout');
  });

  it('cancels when the caller token is cancelled', async () => {
    const { runtime } = runtimeWith(
      new FakeModelProvider({ content: '{"value":1}', latencyMs: 1_000 }),
    );
    const source = createCancellation();
    const promise = runtime.run(makeRequest({ token: source.token, timeoutMs: 5_000 }));
    source.cancel();
    const exec = await promise;
    expect(exec.status).toBe('cancelled');
    expect(exec.error?.code).toBe('cancelled');
  });
});
