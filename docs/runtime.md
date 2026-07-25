# Execution Runtime

`ExecutionRuntime` (`lib/ai/runtime/runtime.ts`) is the reusable orchestrator
that turns an [`ExecutionRequest`](./execution-model.md) into an `Execution`. It
owns the mechanics every AI capability would otherwise duplicate: lifecycle
events, retry, timeout, cancellation, token/cost accounting, structured-output
validation, and secret-free logging. It depends only on the `ModelProvider`
interface, so the model backend swaps freely.

```ts
const runtime = new ExecutionRuntime(getModelProvider());
const execution = await runtime.run(request); // Promise<Execution<T>>
```

## `ExecutionRuntime`

- `constructor(provider: ModelProvider, deps?: Partial<RuntimeDeps>)` —
  `RuntimeDeps` are `{ clock, monotonic, sleep, id, logger }`, all injectable for
  deterministic tests; defaults use real time + the shared `executionLogger`.
- `isAvailable(): boolean` — delegates to the provider (callers gate on this).
- `run<T>(request): Promise<Execution<T>>` — one synchronous execution:
  1. emit `created`/`started` events (`queued → pending → running`);
  2. combine the caller's cancellation token with a timeout into one
     `AbortSignal`;
  3. call `provider.complete(...)` through the **retry policy**;
  4. on success, JSON-parse + Zod-validate the structured output;
  5. classify any failure into a safe `ExecutionError`
     (`timed_out` / `cancelled` / `invalid_output` / `provider_failed`);
  6. compute `metadata` (usage, cost, latency, attempts) and record a
     secret-free log.

`run` never throws for an expected failure — the outcome is always an
`Execution` with a terminal `status`.

## Retry — `lib/ai/runtime/retry.ts`

Execution services consume a policy; they never implement backoff.

- `RetryPolicy` — `{ kind: 'none' | 'fixed' | 'exponential', maxAttempts, baseDelayMs, maxDelayMs }`.
- `NO_RETRY`, `fixedRetry(maxAttempts?, delayMs?)`, `exponentialRetry(maxAttempts?, baseDelayMs?, maxDelayMs?)`.
- `delayForAttempt(policy, attempt): number | null`.
- `runWithRetry(fn, policy, { isRetryable, token, sleep, onRetry }): Promise<{ value, attempts }>`.

The runtime only retries provider errors flagged `retryable` and stops
immediately on cancellation/timeout.

## Cancellation — `lib/ai/runtime/cancellation.ts`

Built on the standard `AbortSignal` so streaming/background executors get true
mid-flight cancellation with no caller change.

- `CancellationToken` — `{ isCancelled, signal, onCancelled(cb) }`.
- `CancellationSource` — `{ token, cancel(reason?) }`.
- `createCancellation(): CancellationSource`.

Pass `request.token` to cancel a run; the runtime distinguishes caller
cancellation (`cancelled`) from a deadline (`timed_out`).

## Accounting — `lib/ai/runtime/accounting.ts`

- `TokenUsage` — `{ inputTokens, outputTokens, totalTokens, estimated }`.
- `CostEstimate` — `{ currency: 'USD', amount, estimated }`.
- `estimateTokens(text)`, `estimateUsage(input, output)`, `estimateCost(model, usage)`.

Development estimates are marked `estimated: true`; the OpenAI provider supplies
exact usage when the API returns it.

## Logging — `lib/ai/runtime/logging.ts`

- `ExecutionLog` — timing, status changes, provider/model, workspace/operator
  ids, usage/cost, tool-call count, and a **safe error message only**. Never
  prompts, content, keys, or credentials.
- `toExecutionLog(execution)` — projection.
- `ExecutionLogger` — `{ record, listByWorkspace }`; `InMemoryExecutionLogger`
  is the dev implementation (bounded, `globalThis`-pinned within a realm).

## Background readiness (interfaces only) — `lib/ai/runtime/background.ts`

No queue/worker/scheduler is implemented. `ExecutionQueue`, `JobStore`,
`BackgroundWorker`, `Scheduler`, and `Job<T>` define the contracts so a durable
implementation drops in later without changing callers — a caller enqueues an
`ExecutionRequest` and reads back an `Execution`, whether it ran inline or on a
worker.
