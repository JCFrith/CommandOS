# Execution Model

The provider- and feature-agnostic domain model for one AI execution. Defined in
`lib/ai/runtime/execution.ts`. Every AI capability (agents today; more later)
describes work as an `ExecutionRequest` and receives an `Execution`.

## Status lifecycle

```
queued → pending → running ─┬─▶ completed
                            ├─▶ failed
                            ├─▶ cancelled
                            └─▶ timed_out
```

`ExecutionStatus` — `queued | pending | running | completed | failed | cancelled | timed_out`.
`timed_out` is distinct from `failed` so callers can treat a deadline miss
differently. `completed | failed | cancelled | timed_out` are terminal.

- `canTransition(from, to): boolean` — legal-transition guard.
- `isTerminalStatus(status): boolean`.
- `TERMINAL_STATUSES: readonly ExecutionStatus[]`.

Only synchronous execution is exercised today; `ExecutionKind`
(`synchronous | asynchronous | scheduled | autonomous`) reserves the others so
the same model supports background/scheduled runs without a redesign.

## Interfaces

| Type                  | Purpose                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExecutionContext`    | Who/where: `workspaceId`, `operatorId`, `operatorName`, optional `subjectId`/`subjectType`. **Ids only — never secrets.**                                                                                                      |
| `ExecutionRequest<T>` | A typed request: `id`, `kind`, `context`, `conversation`, `outputSchema` (Zod), `outputSpec` (JSON schema for the provider), `retryPolicy`, `timeoutMs`, `metadata` (audit tags, no secrets), optional `token` (cancellation). |
| `ExecutionResult<T>`  | `output: T` (validated) + `raw: string` (provider content).                                                                                                                                                                    |
| `ExecutionMetadata`   | `provider`, `model`, `usage` (`TokenUsage`), `cost` (`CostEstimate`), `latencyMs`, `attempts`, `promptVersion`, `toolCalls`.                                                                                                   |
| `ExecutionError`      | Safe failure: `code` (`unavailable \| timeout \| provider_failed \| invalid_output \| cancelled \| tool_failed`), `catalogCode` (`CMD-AI-###`), `message` (user-facing, no internals), `retryable`.                            |
| `ExecutionEvent`      | Timeline entry: `at`, `type`, `status`, optional `detail`.                                                                                                                                                                     |
| `Execution<T>`        | The full record: `id`, `requestId`, `kind`, `context`, `status`, `result`, `error`, `metadata`, `events`, `createdAt`, `completedAt`.                                                                                          |

## Guarantees

- **Structured output** is validated against `ExecutionRequest.outputSchema`; a
  non-conforming response is an `invalid_output` failure, never a crash.
- **Errors are safe.** No secrets, prompts, stack traces, or raw provider
  payloads appear in `ExecutionError` or the events.
- **`T` is caller-owned.** The runtime is generic; the agent domain supplies
  `AgentExecutionResult` and its schema.

See [runtime.md](./runtime.md) for how an `Execution` is produced, and
[ai-runtime.md](./ai-runtime.md) for the platform overview.
