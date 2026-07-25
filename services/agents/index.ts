import { getAIProvider } from '@/lib/ai';
import { agentRepository } from './in-memory-agent-repository';
import { AgentService } from './agent-service';

/**
 * The shared agent service, wired to the active repository and the real AI
 * provider. Server-only (the OpenAI adapter imports `server-only`). Pages,
 * Server Actions, and route handlers import this; tests construct
 * {@link AgentService} directly with a {@link FakeAIProvider}.
 */
export const agentService = new AgentService(agentRepository, getAIProvider());

export { AgentError } from './agent-service';
export type { AgentContext, AgentErrorCode } from './agent-service';
