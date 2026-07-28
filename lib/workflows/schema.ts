import { z } from 'zod';

import type { Condition, WorkflowEdge, WorkflowNode, WorkflowVersion } from './types';

/**
 * Zod schemas + graph validation for workflow definitions. The service parses
 * operator input with these before persisting a new version, so a malformed
 * graph can never reach the runtime. `validateGraph` adds referential-integrity
 * checks that a shape schema cannot express (edges point at real nodes, branch
 * labels have edges, the start node exists, …).
 */

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  description: z.string().trim().max(2_000).optional(),
});

export const updateWorkflowSchema = createWorkflowSchema;

export const transitionWorkflowSchema = z.object({
  to: z.enum(['draft', 'active', 'paused', 'archived']),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(1_000).optional(),
});

export const startRunSchema = z.object({
  input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

// --- Condition (recursive) --------------------------------------------------

const valueRefSchema = z.union([
  z.object({ var: z.string().min(1) }),
  z.object({ literal: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
]);

const compareOpSchema = z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists']);

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('const'), value: z.boolean() }),
    z.object({
      kind: z.literal('compare'),
      left: valueRefSchema,
      op: compareOpSchema,
      right: valueRefSchema.optional(),
    }),
    z.object({ kind: z.literal('and'), all: z.array(conditionSchema).min(1) }),
    z.object({ kind: z.literal('or'), any: z.array(conditionSchema).min(1) }),
    z.object({ kind: z.literal('not'), condition: conditionSchema }),
  ]),
);

// --- Node config (discriminated by type) ------------------------------------

const nodeConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('condition'), expression: conditionSchema }),
  z.object({
    type: z.literal('branch'),
    branches: z.array(z.object({ label: z.string().min(1), when: conditionSchema })).min(1),
  }),
  z.object({ type: z.literal('parallel') }),
  z.object({ type: z.literal('join'), mode: z.enum(['all', 'any']) }),
  z.object({ type: z.literal('delay'), ms: z.number().int().min(0).max(86_400_000) }),
  z.object({
    type: z.literal('approval'),
    approvers: z.enum(['owner', 'admin']),
    prompt: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('agent_run'),
    agentId: z.string().min(1),
    inputTemplate: z.string().max(4_000),
    outputVar: z.string().optional(),
  }),
  z.object({
    type: z.literal('operation_create'),
    titleTemplate: z.string().min(1).max(500),
    priority: z.enum(['low', 'medium', 'high']),
    outputVar: z.string().optional(),
  }),
  z.object({
    type: z.literal('operation_transition'),
    operationIdVar: z.string().min(1),
    to: z.enum(['draft', 'planned', 'in_progress', 'blocked', 'completed', 'archived']),
  }),
  z.object({
    type: z.literal('emit_signal'),
    signalType: z.string().min(1),
    summaryTemplate: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('set_variable'),
    key: z.string().min(1),
    valueTemplate: z.string().max(4_000),
  }),
  z.object({ type: z.literal('end'), result: z.enum(['completed', 'failed']).optional() }),
]);

const retryPolicySchema = z.object({
  kind: z.enum(['none', 'fixed', 'exponential']),
  maxAttempts: z.number().int().min(1).max(10),
  baseDelayMs: z.number().int().min(0),
  maxDelayMs: z.number().int().min(0),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'start',
    'condition',
    'branch',
    'parallel',
    'join',
    'delay',
    'approval',
    'agent_run',
    'operation_create',
    'operation_transition',
    'emit_signal',
    'set_variable',
    'end',
  ]),
  name: z.string().min(1).max(120),
  config: nodeConfigSchema,
  retry: retryPolicySchema.optional(),
  timeoutMs: z.number().int().min(0).max(600_000).optional(),
});

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

const triggerSchema = z.object({
  type: z.enum(['manual', 'signal', 'schedule']),
  signalType: z.string().optional(),
  intervalMs: z.number().int().min(1_000).optional(),
});

const variableSchema = z.object({
  key: z.string().min(1).max(60),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

/** The publishable graph definition (a new version's contents). */
export const workflowDefinitionSchema = z.object({
  nodes: z.array(nodeSchema).min(1).max(100),
  edges: z.array(edgeSchema).max(300),
  triggers: z.array(triggerSchema).max(20),
  variables: z.array(variableSchema).max(50),
  startNodeId: z.string().min(1),
});

export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;

/** Referential-integrity + semantic checks a shape schema cannot express. */
export function validateGraph(def: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  startNodeId: string;
}): string[] {
  const errors: string[] = [];
  const ids = new Set(def.nodes.map((n) => n.id));
  if (ids.size !== def.nodes.length) errors.push('Node ids must be unique.');
  if (!ids.has(def.startNodeId)) errors.push('startNodeId must reference an existing node.');

  const startNode = def.nodes.find((n) => n.id === def.startNodeId);
  if (startNode && startNode.type !== 'start')
    errors.push('The start node must be of type "start".');

  for (const edge of def.edges) {
    if (!ids.has(edge.from)) errors.push(`Edge references unknown node "${edge.from}".`);
    if (!ids.has(edge.to)) errors.push(`Edge references unknown node "${edge.to}".`);
  }

  // Every branch label must have a matching outgoing edge.
  for (const node of def.nodes) {
    if (node.config.type === 'branch') {
      const outLabels = new Set(def.edges.filter((e) => e.from === node.id).map((e) => e.label));
      for (const branch of node.config.branches) {
        if (!outLabels.has(branch.label)) {
          errors.push(`Branch "${branch.label}" on node "${node.id}" has no matching edge.`);
        }
      }
    }
  }

  // Every non-terminal, non-start node should be reachable from start.
  const reachable = new Set<string>([def.startNodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of def.edges) {
      if (reachable.has(edge.from) && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        changed = true;
      }
    }
  }
  for (const node of def.nodes) {
    if (node.type !== 'start' && !reachable.has(node.id)) {
      errors.push(`Node "${node.id}" is unreachable from the start node.`);
    }
  }

  return errors;
}

/** Full validation: shape (Zod) + referential integrity. Returns error messages. */
export function validateDefinition(
  input: unknown,
): { ok: true; def: WorkflowDefinitionInput } | { ok: false; errors: string[] } {
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  const graphErrors = validateGraph(
    parsed.data as unknown as {
      nodes: WorkflowNode[];
      edges: WorkflowEdge[];
      startNodeId: string;
    },
  );
  if (graphErrors.length > 0) return { ok: false, errors: graphErrors };
  return { ok: true, def: parsed.data };
}

export type WorkflowVersionDraft = Omit<
  WorkflowVersion,
  'id' | 'workflowId' | 'workspaceId' | 'version' | 'createdBy' | 'createdAt'
>;
