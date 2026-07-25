import { describe, expect, it } from 'vitest';

import {
  getWorkspaceContext,
  PersonalWorkspaceRepository,
  personalWorkspaceId,
} from '@/services/workspaces/personal-workspace-repository';
import type { AuthUser } from '@/types';

const user: AuthUser = {
  id: 'user-123',
  email: 'ada@commandos.app',
  displayName: 'Ada',
  avatarUrl: null,
};

describe('PersonalWorkspaceRepository', () => {
  const repo = new PersonalWorkspaceRepository();

  it('derives exactly one personal workspace, owned by the user', async () => {
    const workspaces = await repo.listForUser(user);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({
      id: personalWorkspaceId(user.id),
      role: 'owner',
      kind: 'personal',
    });
  });

  it('resolves the workspace by its derived id and rejects others', async () => {
    expect(await repo.getForUser(user, personalWorkspaceId(user.id))).not.toBeNull();
    expect(await repo.getForUser(user, 'personal-other')).toBeNull();
  });
});

describe('getWorkspaceContext', () => {
  it('returns the personal workspace as current for a signed-in user', async () => {
    const { workspaces, current } = await getWorkspaceContext(user);
    expect(workspaces).toHaveLength(1);
    expect(current?.id).toBe(personalWorkspaceId(user.id));
  });

  it('returns an empty context for a signed-out operator', async () => {
    const { workspaces, current } = await getWorkspaceContext(null);
    expect(workspaces).toEqual([]);
    expect(current).toBeNull();
  });
});
