# Platform Runtime

`lib/platform/` — the reusable, **AI-agnostic** runtime foundation every subsystem
builds on. Introduced in Sprint 5.5 by promoting the domain-neutral primitives
out of the AI runtime so Workflows, Notifications, Scheduling, Background
Execution, Integrations, and future subsystems depend on a shared platform layer
rather than on AI-specific infrastructure. This is a pure refactor — **no
behavior changed**.

## Dependency direction

The platform layer sits below every feature and every specialised runtime, and
**never depends on any of them**:

```
        Feature (services / UI)
                 │
                 ▼
        Platform Runtime  (lib/platform)   ◀── owns reusable primitives
                 │
                 ▼
        AI Runtime  (lib/ai)  ── optional, AI-specific; CONSUMES the platform
```

- **Platform must not import AI** (or Signals, or feature services). Enforced and
  verified: `lib/platform/**` imports nothing from `@/lib/ai`, `@/lib/signals`,
  `@/services`, or `@/app`.
- The AI runtime (`lib/ai`) _consumes_ the platform: `ExecutionRuntime` builds on
  the platform's retry, cancellation, execution status machine, and correlation.
- Future `WorkflowRuntime` / `NotificationRuntime` / `IntegrationRuntime` consume
  the same platform contracts **without modification** — they never reach into
  `lib/ai`.

## What the platform owns

| Module                     | Contracts                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform/ids.ts`          | `newId` / `newExecutionId` / `newCorrelationId` / `newJobId` — one id scheme for every runtime                                                                                                 |
| `platform/correlation.ts`  | `CorrelationRef`, `rootCorrelation`, `continueChain`, `childRef` — the causal thread, domain-agnostic                                                                                          |
| `platform/retry.ts`        | `RetryPolicy` (`no`/`fixed`/`exponential`), `runWithRetry`, `delayForAttempt`                                                                                                                  |
| `platform/cancellation.ts` | `CancellationToken` / `CancellationSource` / `createCancellation` (over `AbortSignal`)                                                                                                         |
| `platform/execution.ts`    | `ExecutionKind`, `ExecutionStatus` + status machine (`canTransition`/`isTerminalStatus`/`TERMINAL_STATUSES`), `ExecutionContext` (with `correlationId`), `ExecutionEvent`/`ExecutionEventType` |
| `platform/background.ts`   | **Interface-only, payload-generic** `Job<T>` / `NewJob<T>` / `JobStatus`, `ExecutionQueue`, `JobStore`, `JobHandler`, `BackgroundWorker`, `Scheduler`                                          |

`lib/platform/index.ts` is the barrel; `@/lib/platform` is the import surface.

### Shared runtime contracts — future-consumer ready

The background/queue/worker/scheduler contracts were previously parameterized
over the AI runtime's `ExecutionRequest`/`Execution`, which coupled them to AI.
They are now **payload-generic**: a `Job<T>` wraps an arbitrary, workspace-scoped
payload tagged by `kind`. So:

- the AI runtime can enqueue an execution request (`kind: 'ai.execution'`),
- a future `WorkflowRuntime` enqueues a workflow run (`kind: 'workflow.run'`),
- a future `NotificationRuntime` enqueues a dispatch (`kind: 'notification.send'`),

all through the same `ExecutionQueue` / `JobStore` / `Scheduler` / `BackgroundWorker`
contracts, with a `JobHandler` binding each `kind` to its runtime. No contract
change is required to add a new runtime.

## What stays in the AI runtime (`lib/ai`)

AI-specific concepts remain in `lib/ai` and _consume_ the platform:

- **Providers** (`lib/ai/provider`) — `ModelProvider`, OpenAI/Fake adapters.
- **Conversation / prompts / tools** — the trust boundary, prompt engine, tools.
- **Accounting** (`runtime/accounting.ts`) — `TokenUsage` / `CostEstimate` (tokens
  are inherently AI).
- **AI execution model** (`runtime/execution.ts`) — `ExecutionRequest<T>`
  (conversation + structured output), `ExecutionResult<T>`, the token/cost-bearing
  `ExecutionMetadata`, the AI `ExecutionError` codes, and `Execution<T>`. It
  **re-exports** the generic primitives from `@/lib/platform/execution` so
  existing imports of `@/lib/ai/runtime/execution` keep working unchanged.
- **`ExecutionRuntime`** (`runtime/runtime.ts`) — orchestrates a model call using
  the platform's retry/cancellation/status machine + correlation, and emits
  correlated execution Signals through the injected `SignalPublisher` (D-503/504).
- **Logging** (`runtime/logging.ts`) — the secret-free `ExecutionLog` +
  `InMemoryExecutionLogger` (dev-only).

## Future `WorkflowRuntime` responsibilities (for context)

A future `WorkflowRuntime` (Sprint 6) will live _beside_ `ExecutionRuntime` — a
peer consumer of the platform, not a subclass. It will reuse the platform's
`RetryPolicy`, `CancellationToken`, `ExecutionStatus` machine (extended with
suspended states), `ExecutionContext` + correlation, and the background/scheduler
contracts to drive workflow runs — while calling _into_ the AI runtime (via
`AgentService`) only for AI steps. Because the platform never imports AI, the
workflow runtime can depend on the platform without inheriting any AI coupling.

## Compatibility

Public contracts are preserved: `@/lib/ai/runtime/execution`, `@/lib/ai/runtime`
(barrel), and `@/lib/signals/correlation` (`rootCorrelation`/`continueChain`
re-exported) all expose the same surface as before. The moves were `git mv`
(history-preserving) for retry/cancellation; `background.ts` was generalized (it
had no consumers — interface-only, TD-19). Correlation-id primitives moved to the
platform; `lib/signals/correlation` now builds on them.
