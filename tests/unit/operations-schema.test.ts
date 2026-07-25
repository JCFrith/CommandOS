import { describe, expect, it } from 'vitest';

import {
  createOperationSchema,
  transitionOperationSchema,
  updateOperationSchema,
} from '@/lib/operations/schema';

describe('createOperationSchema', () => {
  it('accepts a valid operation and defaults priority to medium', () => {
    const result = createOperationSchema.safeParse({ title: 'Ship the review' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe('medium');
  });

  it('rejects an empty title', () => {
    const result = createOperationSchema.safeParse({ title: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a title longer than 120 characters', () => {
    const result = createOperationSchema.safeParse({ title: 'x'.repeat(121) });
    expect(result.success).toBe(false);
  });

  it('rejects a description longer than 2000 characters', () => {
    const result = createOperationSchema.safeParse({
      title: 'Valid',
      description: 'y'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown priority', () => {
    const result = createOperationSchema.safeParse({ title: 'Valid', priority: 'urgent' });
    expect(result.success).toBe(false);
  });
});

describe('updateOperationSchema', () => {
  it('requires a priority (no default on edit)', () => {
    const result = updateOperationSchema.safeParse({ title: 'Valid' });
    expect(result.success).toBe(false);
  });
});

describe('transitionOperationSchema', () => {
  it('accepts a known status', () => {
    expect(transitionOperationSchema.safeParse({ to: 'planned' }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(transitionOperationSchema.safeParse({ to: 'nope' }).success).toBe(false);
  });
});
