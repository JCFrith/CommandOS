import { describe, expect, it } from 'vitest';

import { COMMANDS } from '@/lib/commands/registry';

describe('workflow command registration', () => {
  it('registers a navigate command with an href and a create command', () => {
    const nav = COMMANDS.find((c) => c.id === 'nav.workflows');
    expect(nav?.href).toBe('/console/workflows');
    expect(nav?.group).toBe('navigate');

    const create = COMMANDS.find((c) => c.id === 'create.workflow');
    expect(create).toBeDefined();
    expect(create?.group).toBe('create');
  });
});
