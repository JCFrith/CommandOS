import { describe, expect, it } from 'vitest';
import { COMMANDS, commandGroups } from '@/lib/commands/registry';

describe('command registry', () => {
  it('exposes only non-empty groups in canonical order', () => {
    const groups = commandGroups();
    expect(groups.map((g) => g.group)).toEqual(['navigate', 'create', 'agent']);
    for (const section of groups) {
      expect(section.commands.length).toBeGreaterThan(0);
    }
  });

  it('gives every command a stable unique id', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('navigation commands always declare an href', () => {
    for (const command of COMMANDS.filter((c) => c.group === 'navigate')) {
      expect(command.href).toBeTruthy();
    }
  });
});
