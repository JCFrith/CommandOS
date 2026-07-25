import { describe, expect, it } from 'vitest';

import {
  INITIAL_STATUS,
  OPERATION_STATUSES,
  allowedTransitions,
  canTransition,
  isTerminal,
  statusLabel,
} from '@/lib/operations/state-machine';

describe('operation state machine', () => {
  it('exposes the six lifecycle states from the spec', () => {
    expect([...OPERATION_STATUSES]).toEqual([
      'draft',
      'planned',
      'in_progress',
      'blocked',
      'completed',
      'archived',
    ]);
  });

  it('starts new operations in draft', () => {
    expect(INITIAL_STATUS).toBe('draft');
  });

  it('permits exactly the spec transitions', () => {
    expect(allowedTransitions('draft')).toEqual(['planned']);
    expect(allowedTransitions('planned')).toEqual(['in_progress']);
    expect(allowedTransitions('in_progress')).toEqual(['blocked', 'completed']);
    expect(allowedTransitions('blocked')).toEqual(['in_progress']);
    expect(allowedTransitions('completed')).toEqual(['archived']);
    expect(allowedTransitions('archived')).toEqual([]);
  });

  it('accepts legal transitions and rejects illegal ones', () => {
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('blocked', 'in_progress')).toBe(true);
    expect(canTransition('draft', 'completed')).toBe(false);
    expect(canTransition('completed', 'in_progress')).toBe(false);
    expect(canTransition('archived', 'draft')).toBe(false);
  });

  it('treats archived as the only terminal state', () => {
    expect(isTerminal('archived')).toBe(true);
    expect(isTerminal('completed')).toBe(false);
    expect(isTerminal('draft')).toBe(false);
  });

  it('gives human-readable labels', () => {
    expect(statusLabel('in_progress')).toBe('In Progress');
    expect(statusLabel('draft')).toBe('Draft');
  });
});
