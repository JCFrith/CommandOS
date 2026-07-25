import { getModelProvider } from '@/lib/ai/provider';
import { ExecutionRuntime } from '@/lib/ai/runtime/runtime';
import { agentRepository } from './in-memory-agent-repository';
import { AgentService } from './agent-service';

/**
 * The shared agent service, wired to the active repository and an
 * {@link ExecutionRuntime} backed by the real model provider. Server-only (the
 * OpenAI adapter imports `server-only`). Pages, Server Actions, and route
 * handlers import this; tests construct {@link AgentService} directly with a
 * runtime over a {@link FakeModelProvider}.
 */
export const agentService = new AgentService(
  agentRepository,
  new ExecutionRuntime(getModelProvider()),
);

export { AgentError } from './agent-service';
export type { AgentContext, AgentErrorCode } from './agent-service';
