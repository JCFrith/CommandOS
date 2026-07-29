'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';

import type { WorkflowStatus } from '@/lib/workflows/types';
import { getWorkspaceContext } from '@/services/workspace/context';
import { WorkflowError, workflowService } from '@/services/workflows';

export interface WorkflowActionState {
  error: string | null;
}

const NOT_SIGNED_IN: WorkflowActionState = { error: 'You must be signed in to manage workflows.' };
const LIST = '/console/workflows';

async function run<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Create a workflow (draft) and, if a definition is supplied, publish version 1. */
export async function createWorkflowAction(input: {
  name: string;
  description?: string;
  definition?: string;
}): Promise<WorkflowActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return NOT_SIGNED_IN;

  const created = await run(() =>
    workflowService.create(ctx, { name: input.name, description: input.description }),
  );
  if (!created.ok) return { error: created.error };

  if (input.definition && input.definition.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.definition);
    } catch {
      // The draft exists; surface the JSON problem on the detail view.
      revalidatePath(LIST);
      redirect(`${LIST}/${created.value.id}?defError=1` as Route);
    }
    const published = await run(() => workflowService.publish(ctx, created.value.id, parsed));
    if (!published.ok) return { error: published.error };
  }

  revalidatePath(LIST);
  redirect(`${LIST}/${created.value.id}` as Route);
}

export async function publishDefinitionAction(
  id: string,
  definition: string,
): Promise<WorkflowActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return NOT_SIGNED_IN;
  let parsed: unknown;
  try {
    parsed = JSON.parse(definition);
  } catch {
    return { error: 'The definition is not valid JSON.' };
  }
  const result = await run(() => workflowService.publish(ctx, id, parsed));
  if (!result.ok) return { error: result.error };
  revalidatePath(`${LIST}/${id}`);
  return { error: null };
}

export async function transitionWorkflowAction(
  id: string,
  to: WorkflowStatus,
): Promise<WorkflowActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return NOT_SIGNED_IN;
  const result = await run(() => workflowService.transition(ctx, id, { to }));
  if (!result.ok) return { error: result.error };
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${id}`);
  return { error: null };
}

/** Run a workflow manually; redirect to the new run's detail view. */
export async function startWorkflowAction(id: string): Promise<WorkflowActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return NOT_SIGNED_IN;
  const result = await run(() => workflowService.start(ctx, id, {}));
  if (!result.ok) return { error: result.error };
  revalidatePath(`${LIST}/${id}`);
  redirect(`${LIST}/${id}/runs/${result.value.id}` as Route);
}

export async function cancelRunAction(
  workflowId: string,
  runId: string,
): Promise<WorkflowActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return NOT_SIGNED_IN;
  const result = await run(() => workflowService.cancelRun(ctx, runId));
  if (!result.ok) return { error: result.error };
  revalidatePath(`${LIST}/${workflowId}/runs/${runId}`);
  return { error: null };
}

export async function decideApprovalAction(
  workflowId: string,
  runId: string,
  approvalId: string,
  decision: 'approved' | 'rejected',
): Promise<WorkflowActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return NOT_SIGNED_IN;
  const result = await run(() => workflowService.decideApproval(ctx, approvalId, { decision }));
  if (!result.ok) return { error: result.error };
  revalidatePath(`${LIST}/${workflowId}/runs/${runId}`);
  return { error: null };
}
