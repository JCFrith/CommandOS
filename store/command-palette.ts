import { create } from 'zustand';

/**
 * Global UI state for the CommandOS command palette — the primary way an
 * operator drives the system. Kept intentionally minimal; server state lives
 * in TanStack Query, this store holds only ephemeral client UI state.
 */
interface CommandPaletteState {
  open: boolean;
  query: string;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  reset: () => void;
}

export const useCommandPalette = create<CommandPaletteState>((set) => ({
  open: false,
  query: '',
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setQuery: (query) => set({ query }),
  reset: () => set({ open: false, query: '' }),
}));
