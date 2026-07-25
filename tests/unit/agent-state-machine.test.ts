import { describe, expect, it } from 'vitest';

import {
  AGENT_STATUSES,
  INITIAL_STATUS,
  allowedTransitions,
  canTransition,
  isExecutable,
  isTerminal,
  statusLabel,
} from '@/lib/agents/state-machine';

describe('agent state machine', () => {
  it('exposes the five management states', () => {
    expect([...AGENT_STATUSES]).toEqual(['draft', 'active', 'paused', 'disabled', 'archived']);
  });

  it('starts new agents in draft', () => {
    expect(INITIAL_STATUS).toBe('draft');
  });

  it('permits the enable / pause / resume / disable / archive transitions', () => {
    expect(allowedTransitions('draft')).toEqual(['active', 'archived']);
    expect(allowedTransitions('active')).toEqual(['paused', 'disabled', 'archived']);
    expect(allowedTransitions('paused')).toEqual(['active', 'disabled', 'archived']);
    expect(allowedTransitions('disabled')).toEqual(['active', 'archived']);
    expect(allowedTransitions('archived')).toEqual([]);
  });

  it('accepts legal transitions and rejects illegal ones', () => {
    expect(canTransition('draft', 'active')).toBe(true);
    expect(canTransition('active', 'paused')).toBe(true);
    expect(canTransition('paused', 'active')).toBe(true);
    expect(canTransition('disabled', 'active')).toBe(true);
    expect(canTransition('draft', 'paused')).toBe(false);
    expect(canTransition('archived', 'active')).toBe(false);
  });

  it('treats only active as executable', () => {
    expect(isExecutable('active')).toBe(true);
    for (const s of ['draft', 'paused', 'disabled', 'archived'] as const) {
      expect(isExecutable(s)).toBe(false);
    }
  });

  it('treats archived as the only terminal state', () => {
    expect(isTerminal('archived')).toBe(true);
    expect(isTerminal('active')).toBe(false);
  });

  it('labels statuses', () => {
    expect(statusLabel('active')).toBe('Active');
    expect(statusLabel('disabled')).toBe('Disabled');
  });
});
