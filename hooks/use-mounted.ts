'use client';

import { useEffect, useState } from 'react';

/**
 * Returns `true` once the component has mounted on the client. Useful for
 * gating animations and browser-only APIs to avoid hydration mismatches.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
