import { describe, expect, it } from 'vitest';

import { COMMANDS, commandGroups } from '@/lib/commands/registry';

describe('agent command registration', () => {
  it('registers a create-agent action command in the Create group', () => {
    const create = COMMANDS.find((c) => c.id === 'create.agent');
    expect(create).toBeDefined();
    expect(create?.group).toBe('create');
    expect(create?.href).toBeUndefined(); // action, dispatched by id
    const createGroup = commandGroups().find((g) => g.group === 'create');
    expect(createGroup?.commands.some((c) => c.id === 'create.agent')).toBe(true);
  });

  it('keeps the navigate-to-agents command pointing at the list', () => {
    expect(COMMANDS.find((c) => c.id === 'nav.agents')?.href).toBe('/console/agents');
  });

  it('no longer exposes the retired agent.dispatch placeholder', () => {
    expect(COMMANDS.find((c) => c.id === 'agent.dispatch')).toBeUndefined();
  });
});
