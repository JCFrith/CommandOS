import { describe, expect, it } from 'vitest';

import { evaluateCondition, resolveValue } from '@/lib/workflows/conditions';
import {
  interpolate,
  seedVariables,
  setVariable,
  toWorkflowValue,
} from '@/lib/workflows/variables';
import { validateDefinition, validateGraph } from '@/lib/workflows/schema';
import {
  canRunTransition,
  canWorkflowTransition,
  isRunTerminal,
  isTriggerable,
} from '@/lib/workflows/state-machine';
import { STARTER_DEFINITION } from '@/lib/workflows/starter';
import type { Condition } from '@/lib/workflows/types';

describe('condition engine', () => {
  const vars = { n: 10, name: 'Ada', flag: true };
  it('resolves var and literal refs', () => {
    expect(resolveValue({ var: 'n' }, vars)).toBe(10);
    expect(resolveValue({ literal: 'x' }, vars)).toBe('x');
    expect(resolveValue({ var: 'missing' }, vars)).toBeNull();
  });
  it('evaluates comparisons and boolean combinators (no eval)', () => {
    const c: Condition = {
      kind: 'and',
      all: [
        { kind: 'compare', left: { var: 'n' }, op: 'gte', right: { literal: 10 } },
        {
          kind: 'or',
          any: [{ kind: 'compare', left: { var: 'name' }, op: 'eq', right: { literal: 'Ada' } }],
        },
        { kind: 'not', condition: { kind: 'const', value: false } },
      ],
    };
    expect(evaluateCondition(c, vars)).toBe(true);
    expect(
      evaluateCondition(
        { kind: 'compare', left: { var: 'n' }, op: 'lt', right: { literal: 5 } },
        vars,
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        { kind: 'compare', left: { var: 'name' }, op: 'contains', right: { literal: 'd' } },
        vars,
      ),
    ).toBe(true);
    expect(evaluateCondition({ kind: 'compare', left: { var: 'flag' }, op: 'exists' }, vars)).toBe(
      true,
    );
  });
});

describe('variable engine', () => {
  it('seeds from declarations + input with defaults and coercion', () => {
    const vars = seedVariables(
      [
        { key: 'topic', type: 'string', required: false, default: 'default' },
        { key: 'count', type: 'number', required: false, default: 0 },
      ],
      { count: '5', ignored: 'x' },
    );
    expect(vars.topic).toBe('default');
    expect(vars.count).toBe(5);
    expect('ignored' in vars).toBe(false); // only declared keys admitted
  });
  it('interpolates templates and bounds values', () => {
    expect(interpolate('hi {{name}}!', { name: 'Ada' })).toBe('hi Ada!');
    expect(interpolate('{{missing}}', {})).toBe('');
    expect(setVariable({}, 'k', 42).k).toBe(42);
    expect(typeof toWorkflowValue({ nested: true })).toBe('string'); // structured → bounded string
  });
});

describe('definition validation', () => {
  it('accepts the starter definition', () => {
    const result = validateDefinition(STARTER_DEFINITION);
    expect(result.ok).toBe(true);
  });
  it('rejects edges to unknown nodes, a bad start, and unreachable nodes', () => {
    const errors = validateGraph({
      startNodeId: 'missing',
      nodes: [
        { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
        { id: 'orphan', type: 'end', name: 'O', config: { type: 'end' } },
      ],
      edges: [{ from: 's', to: 'ghost' }],
    });
    expect(errors.some((e) => e.includes('startNodeId'))).toBe(true);
    expect(errors.some((e) => e.includes('ghost'))).toBe(true);
    expect(errors.some((e) => e.includes('unreachable'))).toBe(true);
  });
  it('rejects a branch label without a matching edge', () => {
    const errors = validateGraph({
      startNodeId: 's',
      nodes: [
        { id: 's', type: 'start', name: 'S', config: { type: 'start' } },
        {
          id: 'b',
          type: 'branch',
          name: 'B',
          config: {
            type: 'branch',
            branches: [{ label: 'x', when: { kind: 'const', value: true } }],
          },
        },
      ],
      edges: [{ from: 's', to: 'b' }],
    });
    expect(errors.some((e) => e.includes('Branch "x"'))).toBe(true);
  });
});

describe('state machines', () => {
  it('definition lifecycle', () => {
    expect(canWorkflowTransition('draft', 'active')).toBe(true);
    expect(canWorkflowTransition('active', 'paused')).toBe(true);
    expect(canWorkflowTransition('archived', 'active')).toBe(false);
    expect(isTriggerable('active')).toBe(true);
    expect(isTriggerable('paused')).toBe(false);
  });
  it('run lifecycle with suspended states', () => {
    expect(canRunTransition('running', 'waiting_approval')).toBe(true);
    expect(canRunTransition('waiting_approval', 'running')).toBe(true);
    expect(canRunTransition('completed', 'running')).toBe(false);
    expect(isRunTerminal('timed_out')).toBe(true);
    expect(isRunTerminal('waiting_timer')).toBe(false);
  });
});
