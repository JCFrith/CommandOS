import type { Agent, AgentExecutionResult } from '@/types';
import { createConversation, userInput } from '@/lib/ai/conversation/conversation';
import { executionResultSchema, EXECUTION_RESULT_JSON_SCHEMA } from '@/lib/agents/result-schema';
import { exponentialRetry } from '@/lib/platform/retry';
import type { ExecutionContext, ExecutionRequest } from '@/lib/ai/runtime/execution';
import {
  AGENT_PROMPT_VERSION,
  agentSystemPrompt,
  agentUserContent,
} from '@/lib/agents/prompt-templates';

/** Hard ceiling on an agent execution (the runtime also enforces it). */
export const AGENT_EXECUTION_TIMEOUT_MS = 30_000;

/**
 * Build a typed {@link ExecutionRequest} for running `agent` against operator
 * `input`. This is where the agent domain meets the execution runtime: a trusted
 * system prompt + untrusted user content become a conversation, the agent output
 * schema drives structured-output validation, and a retry policy + timeout +
 * audit metadata are attached. The runtime does the rest, provider-agnostically.
 */
export function buildAgentExecutionRequest(
  agent: Agent,
  input: string,
  context: ExecutionContext,
  requestId: string,
): ExecutionRequest<AgentExecutionResult> {
  const conversation = createConversation(
    agentSystemPrompt(agent),
    userInput(agentUserContent(agent, input)),
  );
  return {
    id: requestId,
    kind: 'synchronous',
    context,
    conversation,
    outputSchema: executionResultSchema,
    outputSpec: {
      name: 'agent_execution_result',
      schema: EXECUTION_RESULT_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
    // One retry with backoff; the runtime only retries provider-retryable errors.
    retryPolicy: exponentialRetry(2, 200, 2_000),
    timeoutMs: AGENT_EXECUTION_TIMEOUT_MS,
    metadata: { promptVersion: AGENT_PROMPT_VERSION, agentId: agent.id },
  };
}
