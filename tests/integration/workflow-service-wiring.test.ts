import { describe, expect, it } from 'vitest';

import { PRODUCTION_VALIDATION } from './setup';

/**
 * Defect-3 regression guard. The workflow-service singleton (services/workflows/
 * index.ts) lazily binds its durable approval resumer via
 * `require('@/services/workflows/supabase-durable-trigger-port')`. Under vite-node
 * the native `require()` resolves neither the `@` alias nor `.ts`, so this
 * specifier MUST be intercepted in tests/integration/setup.ts like every other
 * server-only adapter. It was omitted — so importing the singleton threw "Cannot
 * find module", silently breaking durable-resume/durable-triggers. Importing the
 * index here forces that require to run; a missing intercept fails this test.
 */
(PRODUCTION_VALIDATION ? describe : describe.skip)('workflow service durable wiring', () => {
  it('the workflow-service singleton resolves and wires the server-only durable port', async () => {
    const mod = await import('@/services/workflows');
    expect(mod.workflowService).toBeDefined();
  });

  it('the durable trigger port module resolves to the real adapter class', async () => {
    const port = await import('@/services/workflows/supabase-durable-trigger-port');
    expect(typeof port.SupabaseDurableTriggerPort).toBe('function');
  });
});
