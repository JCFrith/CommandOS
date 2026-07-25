import { signalPublisher } from '@/lib/signals';
import { createSignal } from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/signals/correlation';
import { personalWorkspaceId } from '@/services/workspaces/personal-workspace-repository';

/**
 * Authentication Signal emission (best-effort).
 *
 * A successful sign-in is scoped to the operator's personal workspace so it
 * appears on their Signal timeline. A FAILED sign-in has no trusted operator, so
 * it is scoped to the reserved `system` workspace (never surfaced in a personal
 * workspace view) and carries NO email or other PII — only the method. These
 * only fire when auth is actually configured and exercised; nothing is
 * fabricated in an unconfigured environment.
 */

/** The reserved workspace for platform-level (non-tenant) security signals. */
export const SYSTEM_WORKSPACE_ID = 'system';

export async function emitAuthSucceeded(
  user: { id: string; email?: string | null },
  method: string,
): Promise<void> {
  try {
    await signalPublisher.publish(
      createSignal({
        type: 'auth.succeeded',
        workspaceId: personalWorkspaceId(user.id),
        correlation: rootCorrelation(crypto.randomUUID()),
        actorId: user.id,
        actorName: user.email ?? 'operator',
        summary: `signed in via ${method}`,
        subjectType: 'operator',
        subjectId: user.id,
        payload: { method },
      }),
    );
  } catch {
    /* observability must never break auth */
  }
}

export async function emitAuthFailed(method: string): Promise<void> {
  try {
    await signalPublisher.publish(
      createSignal({
        type: 'auth.failed',
        workspaceId: SYSTEM_WORKSPACE_ID,
        correlation: rootCorrelation(crypto.randomUUID()),
        actorId: null,
        actorName: null,
        summary: `sign-in via ${method} failed`,
        subjectType: 'operator',
        subjectId: null,
        // No email / no credentials — PII-safe by construction.
        payload: { method },
      }),
    );
  } catch {
    /* observability must never break auth */
  }
}
