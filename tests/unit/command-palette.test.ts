import { beforeEach, describe, expect, it } from 'vitest';
import { useCommandPalette } from '@/store/command-palette';

describe('command palette store', () => {
  beforeEach(() => {
    useCommandPalette.getState().reset();
  });

  it('toggles open state', () => {
    expect(useCommandPalette.getState().open).toBe(false);
    useCommandPalette.getState().toggle();
    expect(useCommandPalette.getState().open).toBe(true);
  });

  it('tracks the query and resets', () => {
    useCommandPalette.getState().setQuery('deploy');
    useCommandPalette.getState().setOpen(true);
    expect(useCommandPalette.getState().query).toBe('deploy');

    useCommandPalette.getState().reset();
    expect(useCommandPalette.getState()).toMatchObject({ open: false, query: '' });
  });
});
