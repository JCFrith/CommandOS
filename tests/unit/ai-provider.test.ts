import { describe, expect, it } from 'vitest';

import { FakeModelProvider } from '@/lib/ai/provider/fake';
import { ProviderError } from '@/lib/ai/provider/provider';
import type { ModelRequest } from '@/lib/ai/provider/provider';

const req: ModelRequest = { messages: [{ role: 'user', content: 'hi' }] };

describe('FakeModelProvider (provider abstraction)', () => {
  it('returns configured content, model, and usage on success', async () => {
    const provider = new FakeModelProvider({ content: '{"ok":true}' });
    const res = await provider.complete(req);
    expect(res.content).toBe('{"ok":true}');
    expect(res.model).toBe('fake-model');
    expect(res.usage.totalTokens).toBeGreaterThan(0);
    expect(res.finishReason).toBe('stop');
  });

  it('reports availability and capabilities', () => {
    expect(new FakeModelProvider({ available: false }).isAvailable()).toBe(false);
    expect(new FakeModelProvider().capabilities().structuredOutput).toBe(true);
    expect(new FakeModelProvider().capabilities().streaming).toBe(false);
  });

  it('throws the configured ProviderError', async () => {
    const provider = new FakeModelProvider({
      failWith: new ProviderError('failed', 'CMD-AI-002', 'boom', true),
    });
    await expect(provider.complete(req)).rejects.toBeInstanceOf(ProviderError);
  });

  it('fails only the configured number of times, then succeeds (for retry)', async () => {
    const provider = new FakeModelProvider({
      content: '{"ok":true}',
      failWith: new ProviderError('failed', 'CMD-AI-002', 'boom', true),
      failTimes: 1,
    });
    await expect(provider.complete(req)).rejects.toBeInstanceOf(ProviderError);
    const res = await provider.complete(req);
    expect(res.content).toBe('{"ok":true}');
    expect(provider.callCount).toBe(2);
  });

  it('aborts when the signal fires during latency (cancellation/timeout)', async () => {
    const provider = new FakeModelProvider({ content: '{}', latencyMs: 1000 });
    const controller = new AbortController();
    const promise = provider.complete(req, controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(ProviderError);
  });
});
