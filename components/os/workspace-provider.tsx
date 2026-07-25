'use client';

import { createContext, useContext, useMemo, useState } from 'react';

import type { Workspace } from '@/types';

interface WorkspaceContextValue {
  workspaces: Workspace[];
  current: Workspace | null;
  setCurrent: (workspaceId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Seeds the active-workspace context from server-resolved data. The current
 * selection is ephemeral client state; the workspace list is server truth.
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
  const [currentId, setCurrentId] = useState<string | null>(
    initialWorkspaceId ?? workspaces[0]?.id ?? null,
  );

  const value = useMemo<WorkspaceContextValue>(() => {
    const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null;
    return { workspaces, current, setCurrent: setCurrentId };
  }, [workspaces, currentId]);

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
