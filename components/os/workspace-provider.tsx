'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';

import { useWorkspaceStore } from '@/store/workspace';
import type { Workspace } from '@/types';

interface WorkspaceContextValue {
  workspaces: Workspace[];
  current: Workspace | null;
  setCurrent: (workspaceId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Seeds the active-workspace context from server-resolved data. The current
 * *selection id* lives in the global workspace store (ephemeral UI state) so the
 * root-mounted command palette — which sits above this provider — can scope its
 * queries by workspace. The workspace list itself remains server truth.
 */
export function WorkspaceProvider({
  workspaces,
  initialWorkspaceId,
  children,
}: {
  workspaces: Workspace[];
  initialWorkspaceId: string | null;
  children: React.ReactNode;
}) {
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActive = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  // Falls back to the server-resolved id until the store is seeded, so the first
  // paint is correct (no flash) and there is no hydration mismatch.
  const effectiveId = activeId ?? initialWorkspaceId ?? workspaces[0]?.id ?? null;

  // Seed / repair the selection: if the store holds nothing (or a workspace the
  // operator can no longer access), point it at the effective id.
  useEffect(() => {
    if (!workspaces.some((w) => w.id === activeId)) setActive(effectiveId);
  }, [activeId, effectiveId, workspaces, setActive]);

  const value = useMemo<WorkspaceContextValue>(() => {
    const current = workspaces.find((w) => w.id === effectiveId) ?? workspaces[0] ?? null;
    return { workspaces, current, setCurrent: setActive };
  }, [workspaces, effectiveId, setActive]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** Access the active workspace context. Must be used within a WorkspaceProvider. */
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
}
