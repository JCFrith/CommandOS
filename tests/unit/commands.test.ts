import { describe, expect, it } from 'vitest';
import { COMMANDS, commandGroups } from '@/lib/commands/registry';

describe('command registry', () => {
  it('exposes only non-empty groups in canonical order', () => {
    const groups = commandGroups();
    // The 'agent' group is empty since Sprint 4 retired the `agent.dispatch`
    // placeholder in favour of real agents (create.agent lives in 'create').
    // Sprint 5 adds real 'system' commands (signal health / correlations / errors).
    expect(groups.map((g) => g.group)).toEqual(['navigate', 'create', 'system']);
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
