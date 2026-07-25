'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';

import type { OperationStatus } from '@/types';
import type { CreateOperationInput, UpdateOperationInput } from '@/lib/operations/schema';
import { getOperationsContext } from '@/services/operations/context';
import { OperationError, operationsService } from '@/services/operations/operations-service';

/** State returned to a client form; `null` error means success (or a redirect). */
export interface OperationActionState {
  error: string | null;
}

const NOT_SIGNED_IN: OperationActionState = {
  error: 'You must be signed in to manage operations.',
};

const LIST_PATH = '/console/operations';

/**
 * Run a service call, translating expected {@link OperationError}s into a form
 * state. Real bugs propagate. Redirects are never issued from inside `fn`, so
 * Next's redirect signal is never swallowed here.
 */
async function run<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof OperationError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Create an operation, then redirect to its detail view on success. */
export async function createOperationAction(
  input: CreateOperationInput,
): Promise<OperationActionState> {
  const ctx = await getOperationsContext();
  if (!ctx) return NOT_SIGNED_IN;

  const result = await run(() => operationsService.create(ctx, input));
  if (!result.ok) return { error: result.error };

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}/${result.value.id}` as Route);
}

/** Edit an operation, then redirect back to its detail view on success. */
export async function updateOperationAction(
  id: string,
  input: UpdateOperationInput,
): Promise<OperationActionState> {
  const ctx = await getOperationsContext();
  if (!ctx) return NOT_SIGNED_IN;

  const result = await run(() => operationsService.update(ctx, id, input));
  if (!result.ok) return { error: result.error };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  redirect(`${LIST_PATH}/${id}` as Route);
}

/** Transition an operation's status; stays on the detail view and revalidates. */
export async function transitionOperationAction(
  id: string,
  to: OperationStatus,
): Promise<OperationActionState> {
  const ctx = await getOperationsContext();
  if (!ctx) return NOT_SIGNED_IN;

  const result = await run(() => operationsService.transition(ctx, id, { to }));
  if (!result.ok) return { error: result.error };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  return { error: null };
}
