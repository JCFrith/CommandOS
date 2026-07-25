import { describe, expect, it } from 'vitest';

import {
  canCreateAgent,
  canExecuteAgent,
  canManageAgent,
  canViewAgents,
} from '@/lib/agents/permissions';
import type { Agent, AuthUser, AgentStatus, Workspace, WorkspaceRole } from '@/types';

const ws = (role: WorkspaceRole): Workspace => ({
  id: 'ws-1',
  name: 'W',
  slug: 'w',
  role,
  kind: 'personal',
});
const creator: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const other: AuthUser = { id: 'u-2', email: null, displayName: 'Bo', avatarUrl: null };

const agent = (status: AgentStatus, createdBy = creator.id): Agent => ({
  id: 'a-1',
  workspaceId: 'ws-1',
  name: 'A',
  type: 'operations',
  description: null,
  instructions: null,
  capabilities: [],
  status,
  createdBy,
  updatedBy: createdBy,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('agent permissions', () => {
  it('any member may view and create', () => {
    expect(canViewAgents(ws('member'))).toBe(true);
    expect(canCreateAgent(ws('member'))).toBe(true);
  });

  it('creator or admin may manage; other member may not', () => {
    expect(canManageAgent(creator, ws('member'), agent('active'))).toBe(true);
    expect(canManageAgent(other, ws('member'), agent('active'))).toBe(false);
    expect(canManageAgent(other, ws('admin'), agent('active'))).toBe(true);
  });

  it('execute requires manage AND active status', () => {
    expect(canExecuteAgent(creator, ws('member'), agent('active'))).toBe(true);
    // manage but not active
    expect(canExecuteAgent(creator, ws('member'), agent('paused'))).toBe(false);
    expect(canExecuteAgent(creator, ws('member'), agent('disabled'))).toBe(false);
    expect(canExecuteAgent(creator, ws('member'), agent('archived'))).toBe(false);
    // active but not authorized
    expect(canExecuteAgent(other, ws('member'), agent('active'))).toBe(false);
  });
});
