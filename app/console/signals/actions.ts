'use server';

import { revalidatePath } from 'next/cache';

import type { SignalResolution } from '@/lib/signals/types';
import { signalPublisher } from '@/lib/signals';
import { createSignal } from '@/lib/signals/signal';
import { rootCorrelation } from '@/lib/signals/correlation';
import { getWorkspaceContext } from '@/services/workspace/context';
import { SignalError, signalsService } from '@/services/signals';

/** State returned to a client control; `null` error means success. */
export interface SignalActionState {
  error: string | null;
}

const NOT_SIGNED_IN: SignalActionState = { error: 'You must be signed in to manage signals.' };
const LIST_PATH = '/console/signals';

/**
 * Record a command-palette action as a `command.executed` Signal.
 *
 * Feature-service-mediated so the "no UI component publishes directly" rule
 * holds: the palette calls this action, which resolves the workspace (honoring
 * the requested id ONLY for a workspace the caller belongs to — a foreign id
 * resolves to `null`, so it cannot spoof another workspace) and publishes. Best
 * effort — never surfaces an error to the palette.
 */
export async function recordCommandAction(commandId: string, workspaceId?: string): Promise<void> {
  try {
    const ctx = await getWorkspaceContext(workspaceId);
    if (!ctx) return;
    await signalPublisher.publish(
      createSignal({
        type: 'command.executed',
        workspaceId: ctx.workspace.id,
        correlation: rootCorrelation(crypto.randomUUID()),
        actorId: ctx.user.id,
        actorName: ctx.user.displayName,
        summary: `ran command "${commandId}"`,
        subjectType: 'command',
        subjectId: commandId,
        payload: { commandId },
      }),
    );
  } catch {
    /* observability must never break the palette */
  }
}

/** Record an actual workspace switch as a `workspace.changed` Signal. */
export async function recordWorkspaceChangeAction(toWorkspaceId: string): Promise<void> {
  try {
    const ctx = await getWorkspaceContext(toWorkspaceId);
    if (!ctx) return;
    await signalPublisher.publish(
      createSignal({
        type: 'workspace.changed',
        workspaceId: ctx.workspace.id,
        correlation: rootCorrelation(crypto.randomUUID()),
        actorId: ctx.user.id,
        actorName: ctx.user.displayName,
        summary: `switched to ${ctx.workspace.name}`,
        subjectType: 'workspace',
        subjectId: ctx.workspace.id,
        payload: { workspaceId: ctx.workspace.id },
      }),
    );
  } catch {
    /* best effort */
  }
}

/** Acknowledge a signal (appends an append-only lifecycle event). */
export async function acknowledgeSignalAction(id: string): Promise<SignalActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return NOT_SIGNED_IN;
  try {
    await signalsService.acknowledge(ctx, id);
  } catch (error) {
    if (error instanceof SignalError) return { error: error.message };
    throw error;
  }
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  return { error: null };
}

/** Resolve (or dismiss) a signal (appends an append-only lifecycle event). */
export async function resolveSignalAction(
  id: string,
  resolution: SignalResolution = 'resolved',
): Promise<SignalActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return NOT_SIGNED_IN;
  try {
    await signalsService.resolve(ctx, id, resolution);
  } catch (error) {
    if (error instanceof SignalError) return { error: error.message };
    throw error;
  }
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  return { error: null };
}
