'use client';

import { useEffect } from 'react';

/**
 * Binds the global ⌘K / Ctrl-K shortcut that toggles the command palette.
 * `onToggle` should be a stable reference (e.g. a Zustand action).
 */
export function useCommandShortcut(onToggle: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onToggle();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onToggle]);
}
