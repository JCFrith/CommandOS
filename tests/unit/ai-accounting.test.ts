import { describe, expect, it } from 'vitest';

import { estimateCost, estimateTokens, estimateUsage } from '@/lib/ai/runtime/accounting';

describe('token & cost accounting', () => {
  it('estimates tokens (~4 chars/token) and marks estimates honestly', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('12345678')).toBe(2);
    const usage = estimateUsage('input text here', 'output');
    expect(usage.estimated).toBe(true);
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
  });

  it('estimates cost against a model rate and rounds cleanly', () => {
    const usage = { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000, estimated: true };
    const cost = estimateCost('gpt-4o', usage);
    expect(cost.currency).toBe('USD');
    expect(cost.estimated).toBe(true);
    expect(cost.amount).toBeCloseTo(0.0125, 6);
  });

  it('charges nothing for the fake model', () => {
    const usage = { inputTokens: 100, outputTokens: 100, totalTokens: 200, estimated: true };
    expect(estimateCost('fake-model', usage).amount).toBe(0);
  });
});
