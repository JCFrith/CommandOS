import type { OperationPriority, OperationStatus } from '@/types';
import type { RetryPolicy } from '@/lib/platform/retry';
import type { ExecutionContext, ExecutionStatus } from '@/lib/platform/execution';

/**
 * The Workflow domain — declarative, versioned automation graphs that orchestrate
 * work across the platform (Operations, Agents, the AI runtime, Signals).
 *
 * A {@link Workflow} is a workspace-scoped definition with a management lifecycle.
 * Its executable graph is an immutable, versioned {@link WorkflowVersion}
 * (append-only — editing publishes a new version; running instances pin theirs).
 * A {@link WorkflowRun} is one execution, checkpointed per node as
 * {@link WorkflowStepRun}s so it can suspend (approval/timer) and resume — and be
 * reconstructed from its Signal history, not a bespoke history table.
 *
 * These types are pure data (no `server-only`), safe to import server or client.
 */

// --- Definition lifecycle ---------------------------------------------------

/** Management lifecycle of a workflow definition. Only `active` triggers. */
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';

/** A workspace-scoped workflow definition. */
export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  /** The version instances currently pin when triggered. */
  currentVersionId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

// --- Graph ------------------------------------------------------------------

export type WorkflowNodeType =
  | 'start'
  | 'condition'
  | 'branch'
  | 'parallel'
  | 'join'
  | 'delay'
  | 'approval'
  | 'agent_run'
  | 'operation_create'
  | 'operation_transition'
  | 'emit_signal'
  | 'set_variable'
  | 'end';

/** A reference to a value: a variable lookup or an inline literal. */
export type ValueRef = { var: string } | { literal: string | number | boolean | null };

export type CompareOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists';

/**
 * A safe, structured boolean expression over the run's variables. Deliberately
 * NOT a string language — no `eval`, fully deterministic, JSON-serializable.
 */
export type Condition =
  | { kind: 'const'; value: boolean }
  | { kind: 'compare'; left: ValueRef; op: CompareOp; right?: ValueRef }
  | { kind: 'and'; all: Condition[] }
  | { kind: 'or'; any: Condition[] }
  | { kind: 'not'; condition: Condition };

/** Per-node configuration, discriminated by node `type`. */
export type WorkflowNodeConfig =
  | { type: 'start' }
  | { type: 'condition'; expression: Condition }
  | { type: 'branch'; branches: { label: string; when: Condition }[] }
  | { type: 'parallel' }
  | { type: 'join'; mode: 'all' | 'any' }
  | { type: 'delay'; ms: number }
  | { type: 'approval'; approvers: 'owner' | 'admin'; prompt: string }
  | { type: 'agent_run'; agentId: string; inputTemplate: string; outputVar?: string }
  | {
      type: 'operation_create';
      titleTemplate: string;
      priority: OperationPriority;
      outputVar?: string;
    }
  | { type: 'operation_transition'; operationIdVar: string; to: OperationStatus }
  | { type: 'emit_signal'; signalType: string; summaryTemplate: string }
  | { type: 'set_variable'; key: string; valueTemplate: string }
  | { type: 'end'; result?: 'completed' | 'failed' };

/** A node (step) in the graph. */
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: WorkflowNodeConfig;
  /** Optional retry policy for this node's action. */
  retry?: RetryPolicy;
  /** Optional per-node timeout (ms). */
  timeoutMs?: number;
}

/** A directed edge. `label` selects a `branch` node's outgoing path. */
export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

// --- Triggers & variables ---------------------------------------------------

export type WorkflowTriggerType = 'manual' | 'signal' | 'schedule';

/** What starts a run. Signal triggers carry a filter; schedule an interval. */
export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  /** For `signal`: the signal type to react to (workspace-scoped at registration). */
  signalType?: string;
  /** For `schedule`: fixed interval in ms (a simple, dev-friendly recurrence). */
  intervalMs?: number;
}

/** A declared variable, seeded from trigger input or written by step outputs. */
export interface WorkflowVariable {
  key: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  default?: string | number | boolean;
}

/** An immutable, executable version of a workflow's graph. */
export interface WorkflowVersion {
  id: string;
  workflowId: string;
  workspaceId: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggers: WorkflowTrigger[];
  variables: WorkflowVariable[];
  startNodeId: string;
  createdBy: string;
  createdAt: string;
}

// --- Runs, steps, approvals -------------------------------------------------

/**
 * The status of a run. Extends the platform {@link ExecutionStatus} with
 * suspended states (`waiting_*`) that make a run resumable.
 */
export type WorkflowRunStatus =
  | ExecutionStatus // queued | pending | running | completed | failed | cancelled | timed_out
  | 'waiting_approval'
  | 'waiting_timer';

/** A JSON-safe variable value (sanitized — never secrets). */
export type WorkflowValue = string | number | boolean | null;
export type WorkflowVariables = Record<string, WorkflowValue>;

/** How a run was started. */
export interface WorkflowRunTrigger {
  type: WorkflowTriggerType;
  /** The signal id / schedule tick / operator id that fired it. */
  ref: string | null;
}

/**
 * A stable, server-derived identity for one trigger OCCURRENCE, used to
 * deduplicate at-least-once delivery: two runs are never created for the same
 * `(workspace, version, trigger, occurrence)`. Persisted as an idempotency
 * record so the abstraction maps onto a future DB unique constraint.
 */
export interface TriggerClaim {
  workspaceId: string;
  triggerKey: string;
  runId: string;
  createdAt: string;
}

/** One execution of a pinned workflow version. */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  versionId: string;
  workspaceId: string;
  correlationId: string;
  status: WorkflowRunStatus;
  trigger: WorkflowRunTrigger;
  /** The dedup identity of the trigger occurrence, if any (`null` = undeduped). */
  triggerKey: string | null;
  /** The current variable context (a snapshot; updated as steps run). */
  variables: WorkflowVariables;
  /** Nodes ready to execute next (the run frontier) — enables resume. */
  frontier: string[];
  /** Arrivals at each join node, so a join proceeds only when satisfied. */
  joinArrivals: Record<string, number>;
  /** Safe, user-facing failure message — never internals. */
  error: string | null;
  startedBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** The status of a single step (node) run. */
export type WorkflowStepStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting';

/**
 * An append-only checkpoint for one node execution within a run. The unit of
 * resumability: on resume, completed steps are skipped (idempotency by nodeId).
 */
export interface WorkflowStepRun {
  id: string;
  runId: string;
  workspaceId: string;
  nodeId: string;
  nodeType: WorkflowNodeType;
  status: WorkflowStepStatus;
  attempts: number;
  /** Safe, structured detail (sanitized) — e.g. which branch was taken. */
  output: WorkflowVariables;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

/**
 * A persisted delay-node timer that suspends a run until `dueAt`. The durable
 * timer pass claims due, unclaimed timers and enqueues a `workflow.resume` job;
 * `claimedAt` is the atomic claim/consumed marker. Identity is `(runId, nodeId)`
 * so re-suspension on the same node upserts rather than duplicating.
 */
export interface WorkflowTimer {
  id: string;
  workspaceId: string;
  runId: string;
  nodeId: string;
  dueAt: string;
  claimedAt: string | null;
}

export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected';

/** A human-in-the-loop gate that suspends a run until decided. */
export interface WorkflowApproval {
  id: string;
  runId: string;
  workspaceId: string;
  nodeId: string;
  prompt: string;
  /** The role required to decide (`owner`/`admin`). */
  approvers: 'owner' | 'admin';
  status: WorkflowApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
}

/** The resolved caller + correlation used to drive a run (from the platform). */
export type WorkflowRunContext = ExecutionContext;
