# WorkflowRuntime

The graph orchestrator (`lib/workflows/runtime/`) that drives one workflow run to
completion or a suspension point. A **peer of the AI `ExecutionRuntime`** — both
are consumers of the Platform Runtime, not subclasses of each other.

## Dependency direction

```
WorkflowService
      │  builds a run + WorkflowRunContext
      ▼
WorkflowRuntime ── consumes ──▶ Platform Runtime (retry · cancellation · correlation)
      │                          Signals (emit workflow.* via SignalPublisher)
      ├── capability ports ─────▶ (injected) AgentService / OperationsService
      └── run sink ─────────────▶ (injected) WorkflowRepository (checkpoints)
```

**The runtime never imports `lib/ai` or feature services.** It depends only on:

- **Platform Runtime** — `RetryPolicy`/`runWithRetry`, `CancellationToken`/
  `createCancellation`, `continueChain` (correlation).
- **Signals** — `SignalPublisher` + `createSignal` (to emit correlated
  `workflow.*` signals — the audit history).
- **Ports** (`runtime/ports.ts`) — `WorkflowCapabilities` (run an agent, create /
  transition an operation) and `WorkflowRunSink` (checkpoint persistence). The
  wiring injects adapters over the real services; the runtime stays a pure,
  testable orchestrator. This is how "consume Platform, never AI directly" holds.

## Execution model

`start(version, run, ctx)` seeds the frontier at the start node and calls
`advance`; `resume(version, run, ctx)` re-enters `advance` after a suspension
clears. `advance` is a **frontier queue** processor:

1. Pop a node. If already completed (a prior checkpoint), skip — **idempotent on
   resume**.
2. Execute it (the per-type step executor). Checkpoint a `WorkflowStepRun`.
3. Route to successors:
   - `condition` → the `true`/`false`-labelled edge; `branch` → the first
     matching branch's labelled edge.
   - `parallel` → **all** outgoing targets (fan-out).
   - `join` → tracked via `joinArrivals`; proceeds only when satisfied (`all`
     incoming arrived, or `any`).
4. On `approval` (undecided) or `delay` (not elapsed) → **suspend**
   (`waiting_approval` / `waiting_timer`), persist the frontier, and return.
5. On `end` or an empty frontier → finish (`completed`/`failed`).

Between nodes it checks the `CancellationToken` → `cancelled`. Action nodes
(`agent_run`, `operation_*`) run under the node's `RetryPolicy` and optional
timeout (a `CancellationToken` races the action; a timeout fails the run as
`timed_out`).

## Run status machine

Extends the platform `ExecutionStatus` with suspended states:

```
pending → running → { completed | failed | cancelled | timed_out
                    | waiting_approval | waiting_timer }
waiting_approval / waiting_timer → running (resume) | cancelled | failed
```

## Resumability & checkpointing

Each node execution appends an immutable `WorkflowStepRun`; the `WorkflowRun`
persists its `frontier`, `variables`, and `joinArrivals`. So a suspended run (or,
with a durable store, a run interrupted by a restart) resumes exactly where it
left off: `advance` reloads completed steps and skips them by node id. Approvals
resume via `WorkflowService.decideApproval` → `resume`; due timers via
`resumeRun` / the scheduler.

## Signal integration (audit from Signals)

The runtime emits `workflow.run.started/suspended/resumed/completed/failed/
cancelled/timed_out`, `workflow.node.completed/failed`, `workflow.branch.taken`,
and `workflow.approval.requested`, each tagged with the run's `correlationId`
(subject = the run). The Timeline Engine reconstructs the run's history from these
— no separate history system.

**Nested correlation:** when an `agent_run` node executes, the runtime hands the
capability adapter a trusted correlation reference (run correlation id + run/step
ids + workspace + initiating actor); the adapter passes it to
`AgentService.execute` as a server-side `correlation` option. The agent execution
and **all downstream AI-runtime signals inherit the WorkflowRun correlation id**
(with `causationId` preserving parent depth), so an entire flow — workflow run →
agent execution → provider call → retry → completion — is one chain. A standalone
agent run still mints a fresh root; a foreign-workspace or client-supplied
correlation is ignored (validated against the caller's workspace). Owner-scoped
identity for triggered runs remains open debt (TD-33).
