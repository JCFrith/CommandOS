'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';

import type { AgentExecution, AgentStatus } from '@/types';
import type { CreateAgentInput, UpdateAgentInput } from '@/lib/agents/schema';
import { getWorkspaceContext } from '@/services/workspace/context';
import { AgentError, agentService } from '@/services/agents';

export interface AgentActionState {
  error: string | null;
}

/** Run result surfaced to the runner: a gate error, or the execution record. */
export interface RunActionState {
  error: string | null;
  execution: AgentExecution | null;
}

const NOT_SIGNED_IN = 'You must be signed in to manage agents.';
const LIST_PATH = '/console/agents';

/** Run a service call, mapping expected {@link AgentError}s to a message. */
async function run<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof AgentError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function createAgentAction(input: CreateAgentInput): Promise<AgentActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return { error: NOT_SIGNED_IN };

  const result = await run(() => agentService.create(ctx, input));
  if (!result.ok) return { error: result.error };

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}/${result.value.id}` as Route);
}

export async function updateAgentAction(
  id: string,
  input: UpdateAgentInput,
): Promise<AgentActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return { error: NOT_SIGNED_IN };

  const result = await run(() => agentService.update(ctx, id, input));
  if (!result.ok) return { error: result.error };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  redirect(`${LIST_PATH}/${id}` as Route);
}

export async function transitionAgentAction(
  id: string,
  to: AgentStatus,
): Promise<AgentActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return { error: NOT_SIGNED_IN };

  const result = await run(() => agentService.transition(ctx, id, { to }));
  if (!result.ok) return { error: result.error };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  return { error: null };
}

/**
 * Execute an agent. A gate failure (unavailable / not-executable / permission /
 * duplicate / validation) returns an `error`; a completed OR failed model run
 * returns the persisted `execution` (its own status carries success/failure),
 * so the UI shows an honest outcome without claiming false success.
 */
export async function runAgentAction(id: string, input: string): Promise<RunActionState> {
  const ctx = await getWorkspaceContext();
  if (!ctx) return { error: NOT_SIGNED_IN, execution: null };

  const result = await run(() => agentService.execute(ctx, id, { input }));
  if (!result.ok) return { error: result.error, execution: null };

  revalidatePath(`${LIST_PATH}/${id}`);
  return { error: null, execution: result.value };
}
