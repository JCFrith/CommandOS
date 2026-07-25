import { describe, expect, it } from 'vitest';

import { COMMANDS, commandGroups } from '@/lib/commands/registry';
import { paletteSignalsKey, paletteSignalsUrl } from '@/lib/commands/palette';

describe('signal command registration', () => {
  it('registers the signal observability commands', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(ids).toContain('signals.health');
    expect(ids).toContain('signals.correlations');
    expect(ids).toContain('signals.errors');
  });

  it('groups signal commands under System', () => {
    const system = commandGroups().find((g) => g.group === 'system');
    expect(system).toBeDefined();
    expect(system!.commands.map((c) => c.id)).toEqual([
      'signals.health',
      'signals.correlations',
      'signals.errors',
    ]);
  });

  it('View Signals stays a navigation command with an href', () => {
    const viewSignals = COMMANDS.find((c) => c.id === 'nav.signals')!;
    expect(viewSignals.href).toBe('/console/signals');
  });

  it('palette signal feed is workspace-scoped', () => {
    expect(paletteSignalsKey('ws-1')).toEqual(['palette-signals', 'ws-1']);
    expect(paletteSignalsUrl('ws 1')).toBe('/api/signals?workspaceId=ws%201');
  });
});
