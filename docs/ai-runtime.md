# AI Runtime & Platform

The reusable AI execution platform (`lib/ai/`) that every AI capability builds
on. Introduced in Sprint 4.5 to eliminate duplicated AI logic and establish
stable interfaces. It follows the `UI → Service → Adapter → Provider` rule of
`04_API_SPECIFICATION.md`: **UI never calls a model provider; no raw provider
response reaches the UI.**

## Release status

- **v0.4.0** contains Sprint 4 — **Agents & AI** (the agents vertical slice on a
  provider interface).
- **v0.4.5** introduces this shared **AI Runtime platform** and refactors agents
  onto it (behavior unchanged).
- **`ModelProvider`** and **`ExecutionRuntime`** are the **canonical** AI platform
  contracts. Future AI capabilities integrate through them (unless a later ADR
  changes the architecture).
- **Contracts only** (no production implementation this release): streaming
  (`StreamingModelProvider`), MCP (`Transport`/`CapabilityDiscovery`/`ToolAdapter`/
  `ConnectionLifecycle`/`McpRegistration`), and background execution
  (`ExecutionQueue`/`BackgroundWorker`/`Scheduler`/`JobStore`) — TD-19.
- **Development-only**: `InMemoryExecutionLogger` and all feature repositories
  (TD-18); tool-calling is not yet wired into the runtime (TD-20).

## Layers

```
Feature service (e.g. AgentService)
        │  builds a typed ExecutionRequest
        ▼
ExecutionRuntime ──────────── retry · timeout · cancellation
        │                     accounting · logging
        ▼
ModelProvider (OpenAI | Fake) ── model resolved server-side
        │
        ▼
Structured, validated ExecutionResult<T>
```

## Module map

| Area                                               | Module                         | What it provides                                                                                 |
| -------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Execution model                                    | `runtime/execution.ts`         | `Execution`, `ExecutionRequest`, status machine — see [execution-model.md](./execution-model.md) |
| Runtime                                            | `runtime/runtime.ts`           | `ExecutionRuntime.run()` — see [runtime.md](./runtime.md)                                        |
| Retry / cancel / accounting / logging / background | `runtime/*`                    | reusable policies + interfaces                                                                   |
| Provider                                           | `provider/*`                   | `ModelProvider` abstraction (below)                                                              |
| Conversation                                       | `conversation/conversation.ts` | trust-boundary message primitives                                                                |
| Prompt engine                                      | `prompts/engine.ts`            | versioned, typed, composable templates                                                           |
| Tools                                              | `tools/*`                      | tool framework + MCP readiness — see [tool-framework.md](./tool-framework.md)                    |

## Provider layer — `provider/`

Concerns are separated explicitly:

- **Provider** — `ModelProvider`: `id`, `isAvailable()`, `capabilities()`,
  `complete(request, signal)`.
- **Model** — resolved server-side inside the provider from env
  (`openAIConfig()`); **never** from a request, so a client cannot select or
  inject a model.
- **Configuration** — `ModelConfig` (`{ provider, model }`), no secrets.
- **Structured output** — `StructuredOutputSpec` on the request; the runtime
  validates the response against the caller's Zod schema.
- **Streaming** — `StreamingModelProvider` + `ModelStreamChunk` (interfaces
  only; not yet implemented). `supportsStreaming(provider)` is the guard the
  runtime will use once streaming is enabled — no execution-architecture change
  needed.
- **Errors** — `ProviderError` (`unavailable | timeout | failed`, safe message,
  `catalogCode`, `retryable`).

Implementations: `OpenAIModelProvider` (server-only, real) and
`FakeModelProvider` (deterministic; tests/dev only — never wired into the
production factory). `getModelProvider()` returns the real provider;
`isModelAvailable()` gates on configuration. With no key, capabilities run in an
honest **unavailable** state — never fabricated output.

## Conversation model — `conversation/`

The trust boundary is structural:

- `SystemPrompt` (`trusted: true`) is the only source of a `system` message.
- `UserInput` (`trusted: false`) wraps untrusted operator content.
- `createConversation(system, input)` puts the system prompt first and user
  content as a user turn — **operator content can never become a system
  instruction** (prompt-injection defense).
- `ContextWindow.fit(...)` bounds a long conversation to a token budget.

## Prompt engine — `prompts/`

Every system prompt is a versioned, strongly-typed template — no prompt strings
scattered across the codebase.

- `defineTemplate({ id, version, description, inputSchema, template | render })`
  — validates input (Zod) before rendering.
- `interpolate(template, params)`, `composePrompts(...sections)`.
- `PromptRegistry` (`register` / `get` / `has` / `list`) and the shared
  `promptRegistry`. The agent system prompts are registered in
  `lib/agents/prompt-templates.ts`.

## How agents consume the platform

`AgentService.execute` builds an `ExecutionRequest` via
`lib/agents/execution-request.ts` (trusted system prompt + untrusted user
content → conversation; agent output schema; retry + timeout + audit metadata)
and calls `ExecutionRuntime.run`. It maps the resulting `Execution` onto its
`AgentExecution` record. The service no longer contains any AI mechanics — the
runtime owns them, so the next AI capability reuses the same path.

## What is interface-only (this sprint)

Streaming, background execution (queue/worker/scheduler/job store), and MCP.
Their contracts exist so later sprints add implementations without redesigning
callers. See [runtime.md](./runtime.md) and [tool-framework.md](./tool-framework.md).
