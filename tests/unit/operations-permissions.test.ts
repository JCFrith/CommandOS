import { describe, expect, it } from 'vitest';

import {
  canCreateOperation,
  canManageOperation,
  canViewOperations,
  roleAtLeast,
} from '@/lib/operations/permissions';
import type { AuthUser, Operation, Workspace, WorkspaceRole } from '@/types';

function workspace(role: WorkspaceRole): Workspace {
  return { id: 'ws-1', name: 'Workspace', slug: 'w', role, kind: 'personal' };
}

const creator: AuthUser = { id: 'u-1', email: null, displayName: 'Ada', avatarUrl: null };
const other: AuthUser = { id: 'u-2', email: null, displayName: 'Bo', avatarUrl: null };

const op: Operation = {
  id: 'op-1',
  workspaceId: 'ws-1',
  title: 'Op',
  description: null,
  status: 'draft',
  priority: 'medium',
  createdBy: creator.id,
  updatedBy: creator.id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('operation permissions', () => {
  it('ranks roles owner ≥ admin ≥ member', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'member')).toBe(true);
    expect(roleAtLeast('member', 'admin')).toBe(false);
  });

  it('lets any member view and create', () => {
    expect(canViewOperations(workspace('member'))).toBe(true);
    expect(canCreateOperation(workspace('member'))).toBe(true);
  });

  it('lets the creator manage their own operation', () => {
    expect(canManageOperation(creator, workspace('member'), op)).toBe(true);
  });

  it('blocks a non-creator member from managing', () => {
    expect(canManageOperation(other, workspace('member'), op)).toBe(false);
  });

  it('lets admins and owners manage any operation', () => {
    expect(canManageOperation(other, workspace('admin'), op)).toBe(true);
    expect(canManageOperation(other, workspace('owner'), op)).toBe(true);
  });
});
