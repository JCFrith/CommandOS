import { describe, expect, it } from 'vitest';

import { COMMANDS, commandGroups } from '@/lib/commands/registry';

describe('operations command registration', () => {
  it('registers a create-operation action command', () => {
    const create = COMMANDS.find((c) => c.id === 'create.operation');
    expect(create).toBeDefined();
    expect(create?.group).toBe('create');
    // Action command — dispatched by id, not a static href.
    expect(create?.href).toBeUndefined();
  });

  it('registers a navigate-to-operations command pointing at the list', () => {
    const nav = COMMANDS.find((c) => c.id === 'nav.operations');
    expect(nav?.href).toBe('/console/operations');
  });

  it('surfaces the create command under the Create group', () => {
    const create = commandGroups().find((g) => g.group === 'create');
    expect(create?.commands.some((c) => c.id === 'create.operation')).toBe(true);
  });
});
