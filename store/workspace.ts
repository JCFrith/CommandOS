import { create } from 'zustand';

/**
 * The active workspace *selection* — ephemeral UI state (per CLAUDE.md, not
 * server data). It mirrors the WorkspaceProvider's current selection so that
 * out-of-tree consumers (the root-mounted ⌘K palette, which sits above the
 * provider) can scope their queries by workspace. Only the id lives here; the
 * workspace list stays server-provided.
 */
interface WorkspaceUIState {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceUIState>((set) => ({
  activeWorkspaceId: null,
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
}));
