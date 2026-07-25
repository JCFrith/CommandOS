import { describe, expect, it } from 'vitest';

import {
  createAgentSchema,
  executeAgentSchema,
  transitionAgentSchema,
  updateAgentSchema,
} from '@/lib/agents/schema';

describe('createAgentSchema', () => {
  it('accepts a valid agent and defaults capabilities to []', () => {
    const r = createAgentSchema.safeParse({ name: 'Briefer', type: 'executive' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.capabilities).toEqual([]);
  });

  it('rejects an empty name and an unknown type', () => {
    expect(createAgentSchema.safeParse({ name: '', type: 'executive' }).success).toBe(false);
    expect(createAgentSchema.safeParse({ name: 'A', type: 'wizard' }).success).toBe(false);
  });

  it('rejects unknown capabilities and de-duplicates valid ones', () => {
    expect(
      createAgentSchema.safeParse({ name: 'A', type: 'operations', capabilities: ['fly'] }).success,
    ).toBe(false);
    const r = createAgentSchema.safeParse({
      name: 'A',
      type: 'operations',
      capabilities: ['summarize', 'summarize', 'recommend'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.capabilities).toEqual(['summarize', 'recommend']);
  });

  it('enforces size bounds on instructions (request-size guard)', () => {
    expect(
      createAgentSchema.safeParse({ name: 'A', type: 'operations', instructions: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
  });
});

describe('updateAgentSchema', () => {
  it('has no type field (type is immutable)', () => {
    const r = updateAgentSchema.safeParse({ name: 'A', type: 'flight', capabilities: [] });
    // parse succeeds but strips unknown `type`
    expect(r.success).toBe(true);
    if (r.success) expect('type' in r.data).toBe(false);
  });
});

describe('executeAgentSchema (operator input, size-bounded)', () => {
  it('accepts a normal request', () => {
    expect(executeAgentSchema.safeParse({ input: 'Prepare a briefing' }).success).toBe(true);
  });
  it('rejects empty and oversized input', () => {
    expect(executeAgentSchema.safeParse({ input: '  ' }).success).toBe(false);
    expect(executeAgentSchema.safeParse({ input: 'x'.repeat(4001) }).success).toBe(false);
  });
});

describe('transitionAgentSchema', () => {
  it('accepts a known status and rejects an unknown one', () => {
    expect(transitionAgentSchema.safeParse({ to: 'active' }).success).toBe(true);
    expect(transitionAgentSchema.safeParse({ to: 'running' }).success).toBe(false);
  });
});
