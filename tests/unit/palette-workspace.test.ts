import { describe, expect, it, beforeEach } from 'vitest';

import {
  paletteAgentsKey,
  paletteAgentsUrl,
  paletteOperationsKey,
  paletteOperationsUrl,
} from '@/lib/commands/palette';
import { resolveWorkspace } from '@/services/workspace/context';
import { useWorkspaceStore } from '@/store/workspace';
import type { Workspace } from '@/types';

const ws = (id: string): Workspace => ({ id, name: id, slug: id, role: 'owner', kind: 'personal' });

describe('TD-13 · workspace-scoped palette query keys', () => {
  it('produces a distinct cache key per workspace so a switch cannot show stale results', () => {
    expect(paletteOperationsKey('ws-a')).not.toEqual(paletteOperationsKey('ws-b'));
    expect(paletteAgentsKey('ws-a')).not.toEqual(paletteAgentsKey('ws-b'));
    // Same workspace → same (stable) key.
    expect(paletteOperationsKey('ws-a')).toEqual(paletteOperationsKey('ws-a'));
    // A null (no active workspace) key is distinct from any real workspace.
    expect(paletteAgentsKey(null)).not.toEqual(paletteAgentsKey('ws-a'));
  });

  it('encodes the workspace id into every palette request', () => {
    expect(paletteOperationsUrl('ws a/b')).toBe('/api/operations?workspaceId=ws%20a%2Fb');
    expect(paletteAgentsUrl('ws-1')).toBe('/api/agents?workspaceId=ws-1');
  });
});

describe('TD-13 · server workspace scoping (resolveWorkspace)', () => {
  it('honors a requested workspace only when the caller is a member', () => {
    const workspaces = [ws('personal-me')];
    expect(resolveWorkspace(workspaces)?.id).toBe('personal-me');
    expect(resolveWorkspace(workspaces, 'personal-me')?.id).toBe('personal-me');
    // A foreign id the caller does not belong to → null (no cross-workspace read).
    expect(resolveWorkspace(workspaces, 'personal-other')).toBeNull();
    expect(resolveWorkspace([], undefined)).toBeNull();
  });
});

describe('TD-13 · active workspace selection store', () => {
  beforeEach(() => useWorkspaceStore.setState({ activeWorkspaceId: null }));

  it('switching the active workspace updates the id used for query keys', () => {
    const { setActiveWorkspaceId } = useWorkspaceStore.getState();
    setActiveWorkspaceId('ws-a');
    const before = paletteOperationsKey(useWorkspaceStore.getState().activeWorkspaceId);
    setActiveWorkspaceId('ws-b');
    const after = paletteOperationsKey(useWorkspaceStore.getState().activeWorkspaceId);
    expect(before).not.toEqual(after);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-b');
  });
});
