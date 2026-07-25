import { z } from 'zod';

import type { AgentStatus } from '@/types';
import { AGENT_STATUSES } from '@/lib/agents/state-machine';

/**
 * Validation schemas for agent input, shared by the client forms and the server
 * actions (which re-validate — the authoritative boundary). All bounds double as
 * request-size limits: operator-provided free text is capped so a client cannot
 * submit an excessive payload to the AI provider.
 */

export const AGENT_TYPES = [
  'executive',
  'operations',
  'communications',
  'flight',
  'property',
] as const;
export const AGENT_CAPABILITIES = [
  'summarize',
  'prioritize',
  'draft',
  'analyze',
  'recommend',
] as const;

export const agentTypeSchema = z.enum(AGENT_TYPES);
export const agentCapabilitySchema = z.enum(AGENT_CAPABILITIES);
export const agentStatusSchema = z.enum(
  AGENT_STATUSES as unknown as [AgentStatus, ...AgentStatus[]],
);

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Give the agent a name.')
  .max(80, 'Keep the name under 80 characters.');

const descriptionSchema = z
  .string()
  .trim()
  .max(500, 'Descriptions are limited to 500 characters.')
  .optional();

const instructionsSchema = z
  .string()
  .trim()
  .max(2000, 'Instructions are limited to 2000 characters.')
  .optional();

const capabilitiesSchema = z
  .array(agentCapabilitySchema)
  .max(AGENT_CAPABILITIES.length)
  // De-duplicate; order is not significant.
  .transform((caps) => [...new Set(caps)]);

/** Fields accepted when creating an agent. */
export const createAgentSchema = z.object({
  name: nameSchema,
  type: agentTypeSchema,
  description: descriptionSchema,
  instructions: instructionsSchema,
  capabilities: capabilitiesSchema.default([]),
});

/** Fields accepted when editing an agent (type is immutable after creation). */
export const updateAgentSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  instructions: instructionsSchema,
  capabilities: capabilitiesSchema,
});

/** Input accepted when requesting a lifecycle transition. */
export const transitionAgentSchema = z.object({ to: agentStatusSchema });

/** Input accepted when requesting an execution — operator content, size-bounded. */
export const executeAgentSchema = z.object({
  input: z
    .string()
    .trim()
    .min(1, 'Describe what you want the agent to do.')
    .max(4000, 'Keep the request under 4000 characters.'),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type ExecuteAgentInput = z.infer<typeof executeAgentSchema>;
