# Workflows & Automation

The workflow platform (`lib/workflows/`, `services/workflows/`) — declarative,
versioned automation graphs that orchestrate work across CommandOS: Operations,
Agents, the AI runtime, and Signals. Introduced in Sprint 6, built entirely on
the platform foundation (Auth, Workspaces, Operations, Agents, AI Runtime, the
**Platform Runtime**, the **SignalBus**, and the **Timeline/Observability**
layer).

It follows the established architecture: `UI → Feature Service → Runtime →
Repository → Persistence`, and two hard rules:

- **`WorkflowRuntime` consumes the Platform Runtime, never AI infrastructure**
  directly. AI/operation actions are reached through injected **capability
  ports** (dependency inversion); only the wiring adapter touches `lib/ai`.
- **A run's audit history is reconstructed from Signals** — there is no bespoke
  history table. The `WorkflowStepRun` checkpoints exist for _resumability_ (the
  execution mechanism), while the human-facing timeline comes from `workflow.*`
  Signals via the Timeline Engine.

## Domain (`lib/workflows/types.ts`)

| Type               | What it is                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `Workflow`         | workspace-scoped definition with a `draft → active ⇄ paused → archived` lifecycle                |
| `WorkflowVersion`  | immutable, versioned graph (`nodes`, `edges`, `triggers`, `variables`, `startNodeId`)            |
| `WorkflowNode`     | a step; `config` is a discriminated union over 13 node types (below); optional `retry`/`timeout` |
| `WorkflowEdge`     | directed edge; `label` selects a branch/condition path                                           |
| `WorkflowTrigger`  | `manual` / `signal` (by type) / `schedule` (interval)                                            |
| `WorkflowVariable` | declared, typed variable (seeded from trigger input + defaults)                                  |
| `WorkflowRun`      | one execution: `status`, `variables`, `frontier`, `joinArrivals`, `correlationId`, trigger       |
| `WorkflowStepRun`  | append-only per-node checkpoint (the unit of resumability)                                       |
| `WorkflowApproval` | a human-in-the-loop gate that suspends a run                                                     |

**Node types:** `start`, `condition`, `branch`, `parallel`, `join`, `delay`,
`approval`, `agent_run`, `operation_create`, `operation_transition`,
`emit_signal`, `set_variable`, `end`.

### Conditions & variables

- **Condition engine** (`conditions.ts`): a **safe, structured** boolean
  expression (`const`/`compare`/`and`/`or`/`not` over variable/literal refs) —
  **no `eval`, no string language**, deterministic and injection-proof.
- **Variable engine** (`variables.ts`): a flat, JSON-safe store seeded from
  trigger input + declared defaults, written by step outputs, read by conditions
  and `{{var}}` templates. Values are bounded primitives, safe to checkpoint and
  (after the Signal layer's sanitization) to audit.
- **Validation** (`schema.ts`): Zod shape validation + `validateGraph`
  referential integrity (edges point at real nodes, branch labels have edges,
  the start node exists and is `start`-typed, all nodes reachable). Every version
  is validated on publish.

## Triggers (`services/workflows/trigger-engine.ts`)

- **Signal** — subscribes to the SignalBus (workspace-scoped, by signal type). A
  guard drops signals emitted **by** workflows (`source: 'workflows'`), so a
  workflow can never trigger itself into an infinite cascade.
- **Schedule** — held in an in-process registry; `runDueSchedules(nowMs)` fires
  the ones whose interval elapsed. (A production timer/worker is future work — the
  registry is the seam; TD-31.)
- **Manual** — an authorized operator starts a run.

Registration is driven by the lifecycle: a workflow registers when it goes
`active`, unregisters when paused/archived.

## Service (`services/workflows/workflow-service.ts`)

Owns validation, RBAC + workspace scoping, versioning, and run orchestration;
delegates execution to the `WorkflowRuntime` and audit to Signals. Every read is
scoped to `ctx.workspace.id` (a caller can never touch another workspace's
workflows/runs). Emits `workflow.created|updated|activated|paused|archived` and
run/approval signals.

Key use cases: `create`, `update`, `publish` (a new version), `transition`,
`start` (manual run), `cancelRun`, `resumeRun` (due timer), `decideApproval`
(then resume), `runDueSchedules`.

## Runtime & resumability

See [workflow-runtime.md](./workflow-runtime.md). In short: the runtime walks the
graph node-by-node, checkpointing each `WorkflowStepRun`, and **suspends** at an
approval (`waiting_approval`) or a positive delay (`waiting_timer`), persisting
the frontier so the run **resumes** exactly where it left off — completed steps
are skipped by node id (idempotent). Retries use the Platform `RetryPolicy`;
timeouts + cancellation use the Platform `CancellationToken`; correlation uses the
Platform `CorrelationRef`.

## UI

`/console/workflows` (list + create), `/console/workflows/[id]` (definition,
versions, runs, lifecycle + run controls), `/console/workflows/[id]/runs/[runId]`
(the **signal-derived timeline**, step checkpoints, variables, approval/cancel
controls). ⌘K: Go to / New Workflow. Workspace-scoped `/api/workflows` feed. The
create form ships a valid **starter template**; a visual graph editor is future
work (TD-32).

## Security invariants

- **Workspace isolation** across workflows, versions, runs, approvals, and the
  signal-derived timeline (all scoped to `ctx.workspace.id`).
- **No self-trigger cascades** (`source: 'workflows'` signals never re-trigger).
- **Safe conditions** (no eval), **bounded/JSON-safe variables**, and **Signal
  payload sanitization** on every emitted signal.
- Agent/operation steps run through the authoritative services, so RBAC + the
  agent trust boundary are enforced there; the runtime never bypasses them.
