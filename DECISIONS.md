# Decisions

A running log of engineering decisions made while building CommandOS —
lighter-weight than the formal Architecture Decision Records. Foundational,
long-lived architectural decisions live in [`docs/adr/`](./docs/adr/); this file
captures the sprint-level implementation choices that don't warrant a full ADR.

On any conflict, `MASTER_BUILD.md` is authoritative (see `CLAUDE.md`).

## Formal ADRs

| ADR                                           | Title                                                           | Status   |
| --------------------------------------------- | --------------------------------------------------------------- | -------- |
| [0001](./docs/adr/0001-nextjs-app-router.md)  | Next.js App Router as the application framework                 | Accepted |
| [0002](./docs/adr/0002-supabase.md)           | Supabase for auth and persistence, behind repository interfaces | Accepted |
| [0003](./docs/adr/0003-ai-command-surface.md) | A command surface as the primary interaction model              | Accepted |
| [0004](./docs/adr/0004-feature-flags.md)      | Feature flags for progressive delivery                          | Proposed |

## Sprint 2 — Auth & Workspaces (2026-07-24)

### D-201 · Session validation uses `getUser()`, never `getSession()`

`getUser()` re-validates the JWT with Supabase's auth server on every call;
`getSession()` trusts the (spoofable) cookie. All server-side session reads —
middleware, `getCurrentUser()`, the callback — use `getUser()`. `getCurrentUser`
is wrapped in React `cache` so the layout and page share one round-trip per
request.

### D-202 · Auth is optional at runtime, gated on configuration

When `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` are absent, middleware, route
guards, and server actions no-op and the console stays reachable. This keeps the
app buildable and locally runnable without secrets. `isSupabaseConfigured()` is
the single gate.

### D-203 · Two-layer route protection (middleware + RSC)

Middleware is the primary gate (redirects before render); the console layout
re-checks `getCurrentUser()` as defense in depth and to hand the resolved user to
the RSC tree. Neither layer is load-bearing alone.

### D-204 · Supabase server client decoupled from unrelated secrets

`createClient()` builds from `supabasePublicConfig()` (the two public keys)
rather than the full `serverEnv()`. Auth no longer transitively requires
`OPENAI_API_KEY` or the service-role key to be present.

### D-205 · Workspaces behind a repository interface; personal-derived today

Feature code depends on `WorkspaceRepository`; the current
`PersonalWorkspaceRepository` derives exactly one real workspace per operator
(deterministic id, no placeholder rows). Shared team workspaces (Supabase-backed)
swap the implementation, not the call sites — consistent with ADR 0002.

### D-206 · Active workspace is ephemeral client state

The workspace list is server truth; the _selected_ workspace lives in
`WorkspaceProvider` client state (Zustand is reserved for cross-cutting UI
state). With one workspace today this is inert, but the seam is in place.

### D-207 · Open-redirect guard on the auth callback

The callback only honors a `next` param that is a same-origin relative path —
protocol-relative (`//host`) and backslash (`/\host`) forms are rejected and fall
back to `/console`.

## Sprint 3 — Operations (2026-07-25)

### D-301 · Operation lifecycle = the "Task" state machine, verbatim

`Operation` uses the six-state "Task" lifecycle from
`33_STATE_MACHINE_SPECIFICATION.md` (`draft → planned → in_progress ⇄ blocked`,
`in_progress → completed → archived`) — replacing the Sprint-0
`idle/queued/running` scaffold, which had no documented transitions. Only the six
transitions the spec lists are legal; there is deliberately no cancel path.
Archived is terminal and read-only. Rationale: CLAUDE.md forbids inventing
architecture — follow the spec.

### D-302 · In-memory dev repository now; Supabase adapter deferred (APPROVED)

**Status: approved by the product owner at the Sprint 3 pre-merge review
(2026-07-25).** Operations persistence remains the in-memory development
implementation until the planned Supabase persistence sprint defined in the
implementation roadmap.

`docs/roadmap.md` scheduled the Supabase operations migration in Sprint 3, but
the sprint directive is an in-memory/local implementation "suitable for
development." We ship a real in-memory `OperationsRepository` (not a stub) behind
the interface and defer the Supabase adapter. Trade-off: the in-memory store is
per-worker, so it does not share state across a multi-worker `next start` /
serverless deployment — acceptable for local dev; the Supabase adapter is the
production path. Consistent with ADR 0002 (swap implementations, not call sites).

The `OperationsRepository` and `OperationsService` interfaces are the **stable
contract**: the Supabase adapter must implement the existing interface without
changing UI components or domain logic. Verified at review — no UI or service
code imports the in-memory implementation; only `operations-service.ts` (default
binding) and the tests reference it, and the interface is domain-types-in/out so
the adapter is pure row mapping.

### D-303 · Workspace scoping maps `organization_id` → `workspaceId`

The schema (`03`) tenants on `organization_id`; the app's tenant boundary is the
Sprint-2 `Workspace`. Operations scope to `workspaceId`; the service always loads
by the caller's workspace and the repository filters by it (defense in depth).

### D-304 · Validation and authorization live in the service

The service parses input with the authoritative Zod schemas and enforces RBAC +
ownership before any write — the real boundary. Client forms re-validate with the
same schemas for UX only. Actions are thin: resolve context → call service →
revalidate/redirect.

### D-305 · RSC-first; server actions over client data-fetching for mutations

List/detail/create/edit are Server Components reading the service directly (like
the Sprint-2 console layout); mutations are Server Actions with `revalidatePath`.
Only the form and the transition controls are client components. TanStack Query is
used for the one genuinely client-driven read: the ⌘K palette's live operations
feed (`/api/operations`).

### D-306 · Local dev operator when auth is unconfigured

`getOperationsContext` falls back to a fixed `local-operator` identity + personal
workspace only when Supabase is not configured, so Operations is usable via
`next dev` without secrets — mirroring how Sprint 2 keeps the console reachable.
Never used when auth is configured.

## Sprint 4 — Agents & AI (2026-07-25)

### D-401 · Agent management lifecycle (a documented judgment call)

`33_STATE_MACHINE_SPECIFICATION.md` defines an execution ("AI Workflow") state
machine but no _management_ lifecycle for an agent definition. The sprint
directive requires enable / disable / pause / resume / archive, so we define one
(`lib/agents/state-machine.ts`): `draft → active ⇄ paused`, `active/paused →
disabled → active`, any non-archived `→ archived` (terminal). Only `active`
agents may execute. This follows the "fail safely / under user control"
principles of `50_AI_AGENT_FRAMEWORK.md`; it is additive, not a contradiction of
spec 33 (which governs execution, modelled separately as `AgentExecutionStatus`).

### D-402 · AI behind a provider interface; strict trust boundaries

Per `04_API_SPECIFICATION.md` ("UI → Service → Adapter → Provider", "never call
model providers from UI", "no raw provider responses reach UI") the model is
reached only through `AIProvider` (`lib/ai`). Concretely:

- **Model selection is centralized** in `openAIConfig()` — never client input.
- **System prompts are trusted**, one per agent type (`lib/agents/prompts.ts`).
  Operator content (an agent's `instructions`, an execution's `input`) is placed
  in the _user_ message under explicit "data, not instructions" delimiters
  (`lib/ai/prompt-builder.ts`) — the prompt-injection boundary.
- **Structured output** is requested with a strict JSON schema and re-validated
  with Zod; a non-conforming payload becomes an `invalid_output` failure, never a
  crash or unsafe render.
- **Errors are safe**: `AIProviderError` carries user-facing messages + an error
  catalog code (`CMD-AI-###`); no secrets, prompts, stack traces, or provider
  internals leak. Executions store audit metadata (model, prompt version,
  duration) but never the key or system prompt.

### D-403 · No fabricated success; honest "unavailable" state

There is no silent fake-provider fallback in production. When OpenAI is not
configured, `execute` raises `unavailable` and the runner shows an honest notice
— it never invents output. The deterministic `FakeAIProvider` is test/dev-only
and never wired into the production factory.

### D-404 · Synchronous execution only; no autonomous background runs

Sprint 4 implements the smallest complete execution workflow: an authorized
operator runs an active agent synchronously (pending → running →
completed/failed). No autonomous/background execution (the specs don't require
it here). A duplicate-submission guard (`hasActiveExecution`) plus the client's
disabled-while-pending button prevent replay. `cancelled` exists in the type for
a future async workflow but is unreachable today (documented in TECH_DEBT).

### D-405 · TD-13 resolved — workspace-scoped command palette

Palette queries are keyed by the active workspace id (`lib/commands/palette.ts`),
so a workspace switch uses a distinct cache entry and never shows a previous
workspace's results. The id is sourced from a small `store/workspace.ts` (the
selection is ephemeral UI state) which the `WorkspaceProvider` mirrors, so the
root-mounted palette — which sits above the provider — can read it. Requests
carry the id; the server honors it only for a workspace the caller belongs to
(`resolveWorkspace`), so a foreign id can never read another workspace's data.

### D-406 · Shared workspace context + role helper (dedup)

`getWorkspaceContext` (`services/workspace/context.ts`) and `roleAtLeast`
(`lib/authz/roles.ts`) are now shared by operations and agents, so workspace
resolution and RBAC are defined once (operations was refactored onto them).

## Sprint 4.5 — AI Runtime & Platform Foundation (2026-07-25)

Platform sprint: no new end-user features; build the reusable AI execution
platform and refactor agents onto it. Full design in `docs/ai-runtime.md`,
`docs/runtime.md`, `docs/execution-model.md`, `docs/tool-framework.md`.

### D-451 · A generic execution runtime owns AI mechanics

`ExecutionRuntime` (`lib/ai/runtime`) centralises the provider call, retry,
timeout, cancellation, accounting, structured-output validation, and logging
that were previously inline in `AgentService.execute`. Feature services now build
a typed `ExecutionRequest` and map the returned `Execution` — no duplicated AI
logic. The runtime is generic over the output type `T`, so every future AI
capability reuses it.

### D-452 · Execution status is a superset supporting future execution kinds

The runtime models `queued → pending → running → {completed, failed, cancelled,
timed_out}` with an `ExecutionKind` of `synchronous | asynchronous | scheduled |
autonomous`. Only synchronous is exercised; the richer status/kind set means
async/scheduled/background execution needs no redesign (`timed_out` is distinct
from `failed` by design).

### D-453 · Provider abstraction strengthened; model stays server-side

The old agent-specific `AIProvider` (returned `AgentExecutionResult`) is replaced
by a generic `ModelProvider` returning raw content + usage. Concerns are
separated (provider / model / config / structured output / streaming). Model
selection lives only in `openAIConfig()` — never on a request — so a client can
never inject a model. Structured output is validated by the runtime against a
caller Zod schema (a bad response is `invalid_output`, not a crash).

### D-454 · Trust boundary is structural in the conversation model

`SystemPrompt` (`trusted:true`) is the only source of a `system` message;
`UserInput` (`trusted:false`) is always a user turn. Prompt-injection defense is
enforced by construction, and all system prompts are versioned templates in the
prompt engine (`prompts/engine.ts`) — no scattered prompt strings.

### D-455 · Interface-only for streaming, background execution, and MCP

Per the sprint directive, streaming (`StreamingModelProvider`), background
execution (`ExecutionQueue`/`BackgroundWorker`/`Scheduler`/`JobStore`), and MCP
(`Transport`/`CapabilityDiscovery`/`ToolAdapter`/`ConnectionLifecycle`/
`McpRegistration`) are defined as contracts only. They are shaped so a later
implementation drops in without changing callers, and kept provider-independent.

### D-456 · Behavior preservation over the refactor

Agent execution behavior is unchanged: the same `AgentExecution` shape, statuses,
gates (authz / executable / unavailable / duplicate), and honest unavailable
state. Verified by the preserved agent tests + a runtime smoke; the only visible
change is internal (execution now flows through the runtime).

## Release confirmations (2026-07-25 — v0.4.0 / v0.4.5)

Confirmed by the product owner at the two-phase release:

- **Merge sequence.** `sprint-4-agents-ai` merged into `main` first (**v0.4.0**),
  then `sprint-4.5-ai-runtime` merged into the updated `main` (**v0.4.5**). Both
  are **non-fast-forward** merges; feature branches are **not squashed** and their
  commit history is preserved.
- **D-453 approved — `ModelProvider` is the canonical AI provider boundary.** The
  removed agent-specific `AIProvider` is **not** to be restored. Future AI
  capabilities integrate through `ModelProvider` + `ExecutionRuntime` unless a
  later ADR explicitly changes that architecture.
- **D-455 approved — streaming, MCP, background execution, scheduling, queues,
  workers, and job storage remain interface-only** in Sprint 4.5. No production
  implementation is added in this release; **TD-19 and TD-20 stay open** (and
  accurately documented), alongside TD-18 (dev-only execution logging).

## Sprint 5 — Signals & Observability Platform (2026-07-25)

Platform sprint: build the platform-wide event + observability system that every
subsystem emits into. Full design in `docs/signals.md`, `docs/signal-bus.md`,
`docs/observability.md`, `docs/timeline-engine.md`.

### D-501 · Signals are emitted additively; existing behavior is preserved

Emission is best-effort and **never** changes a use case's result (a bus failure
can't break an operation, agent run, or transition). The Sprint 3/4
`OperationActivity`/`AgentActivity` timelines and the `ExecutionLogger` are left
exactly as they are — Signals are a parallel, canonical event stream, not a
replacement. This honors "current functionality must continue exactly as today"
while establishing the platform. Feature services get an injected
`SignalPublisher` that defaults to a no-op, so existing tests and behavior are
unchanged unless the real bus is wired.

### D-502 · Signals are append-only; lifecycle is a projection

An emitted `Signal` is immutable. Acknowledgement/resolution is recorded as
appended `SignalEvent`s and folded into the current `status`/`resolution` at read
time (`projectLifecycle`) — the historical record is never mutated. The
`SignalEventStore` exposes only appends; the durable adapter implements the same
interface.

### D-503 · Architecture — services publish, the bus distributes, the store persists

Per `04_API_SPECIFICATION.md`: `UI → Feature Services → SignalBus →
Repositories → Persistence`. **No UI component and no repository publishes
directly.** Emitters depend only on the narrow `SignalPublisher` seam, never on
subscribers ("nothing depends on downstream consumers"). A built-in persistence
subscriber appends to the append-only store; future consumers (notifications,
monitoring) subscribe without any upstream change. The in-process bus is shaped
so a distributed transport implements the same interface without a redesign.

### D-504 · Correlation is minted at the chain head and preserved automatically

The agent service mints one correlation id per run and threads it into
`ExecutionContext.correlationId`; the runtime tags every execution Signal with
it. So an entire chain — agent run → runtime → provider → retry → completion —
shares one id, reconstructable by the timeline/correlation views without
per-feature plumbing.

### D-505 · Metrics & health are computed from Signals; never fabricated

Observability derives from the event stream (a single source of truth), not a
parallel pipeline. Estimated token/cost figures stay labelled `estimated`; rates
are `null` (not `0`) with no data; provider/runtime availability is read from
configuration (`isOpenAIConfigured`), so an unconfigured environment shows an
honest `unavailable`, never invented activity.

### D-506 · Notification framework is interface-only

`NotificationChannel`/`Message`/`Dispatcher`/`Subscription`/`Rule` are contracts
only — no delivery and no channel implementations this sprint. They are shaped so
Email/Slack/SMS/Teams/Webhook/Push drop in behind them later, consuming the
subscription engine, without changing the Signal platform (TD-22).

### D-507 · Auth-failure signals are `system`-scoped and PII-free

Every Signal is workspace-scoped. A successful sign-in is scoped to the
operator's personal workspace; a FAILED sign-in has no trusted operator, so it is
scoped to a reserved `system` workspace (never surfaced in a tenant view) and
carries only the method — no email, no credentials. Auth signals fire only when
auth is actually configured and exercised; nothing is fabricated otherwise.

## Sprint 5.5 — Platform Runtime (2026-07-27)

Architectural refactor: promote the reusable runtime primitives out of the AI
runtime into a shared platform layer. No new features; behavior identical. Full
design in `docs/platform-runtime.md`.

### D-551 · A platform runtime owns the AI-agnostic primitives

`lib/platform/` owns retry, cancellation, execution identifiers, correlation, the
generic execution status machine + context + events, and the background/queue/
worker/scheduler/job-store contracts. These are not AI-specific, so every runtime
(AI today; Workflow / Notification / Integration tomorrow) depends on one
foundation instead of reaching into `lib/ai`.

### D-552 · Dependency direction is one-way: Feature → Platform → AI

`lib/platform` must **never** import `lib/ai` (or Signals / services / app).
Verified by inspection: platform has zero upward imports. The AI runtime consumes
the platform; the AI `ExecutionRuntime` remains AI-specific and stays in `lib/ai`.
This keeps the platform reusable by non-AI runtimes with no coupling.

### D-553 · Background contracts are payload-generic, not AI-coupled

The queue/worker/scheduler/job-store interfaces were parameterized over the AI
`ExecutionRequest`/`Execution`, which made them unusable by other runtimes. They
are now generic over a `Job<T>` tagged by `kind`, with a `JobHandler` binding a
kind to its runtime — so a future `WorkflowRuntime`/`NotificationRuntime` consumes
them unchanged. They remain interface-only (TD-19); the generalization was safe
because they had no consumers yet.

### D-554 · Preserve public contracts across the move

`retry`/`cancellation` were `git mv`d (history preserved); the AI
`runtime/execution.ts` re-exports the platform primitives; the AI runtime barrel
re-exports platform retry/cancellation for convenience; and
`@/lib/signals/correlation` re-exports the generic chain constructors. Existing
import paths keep working, so the refactor is behavior- and contract-preserving.

## Sprint 6 — Workflows & Automation (2026-07-27)

Build the workflow platform on the completed foundation. Full design in
`docs/workflows.md` and `docs/workflow-runtime.md`.

### D-601 · WorkflowRuntime consumes the Platform Runtime, never AI directly

`WorkflowRuntime` (`lib/workflows/runtime`) depends only on the Platform Runtime
(retry, cancellation, correlation), Signals (emission), and injected **capability
ports** (`WorkflowCapabilities`, `WorkflowRunSink`). Agent/operation actions are
reached through adapters injected by the wiring layer — the runtime never imports
`lib/ai` or feature services. It is a **peer** of the AI `ExecutionRuntime`, not a
subclass (honors D-552).

### D-602 · Workflow history is reconstructed from Signals

There is no bespoke workflow-history table. `WorkflowStepRun` checkpoints exist
for **resumability** (execution state); the human-facing audit history is the
`workflow.*` Signal stream rendered by the Timeline Engine (subject = the run).
This is the first domain to fully realize the D-501 "timeline from Signals"
vision.

### D-603 · Conditions are a safe structured expression, not a string language

`condition`/`branch` guards use a structured `Condition` AST evaluated by
`conditions.ts` — no `eval`, no code execution, only variable lookups + literals +
comparisons + boolean combinators over the flat variable store. Injection-proof
and deterministic. Variables are bounded JSON-safe primitives.

### D-604 · Resumability via per-node checkpoints + frontier persistence

A run persists its `frontier`, `variables`, and `joinArrivals`, and appends an
immutable `WorkflowStepRun` per node. Suspension (`waiting_approval`/
`waiting_timer`) returns control; `resume` re-enters the processor and skips
completed steps by node id (idempotent). This is the seam for durable, cross-
restart resumability once persistence lands.

### D-605 · Triggered runs execute as an owner-scoped context (dev model)

Signal/scheduled runs have no interactive caller, so the capability adapter
reconstructs an owner-scoped `WorkspaceContext` from the run context (personal
workspace, mirroring D-306). Team-workspace role fidelity for triggered runs is
future work (TD-33). A self-trigger guard drops `source: 'workflows'` signals so a
workflow cannot trigger itself into a cascade.

### D-606 · Dev in-memory persistence behind a repository interface

Workflows/versions/runs/steps/approvals run on a dev in-memory
`WorkflowRepository` (globalThis-pinned), like every other domain (D-302). The
runtime checkpoints through the `WorkflowRunSink` subset of that interface; the
Supabase adapter swaps in without changing the runtime, service, or UI.

### D-607 · Nested correlation via a trusted, server-side execution context (correction)

`AgentService.execute` accepts an optional **trusted** `correlation` option
(`correlationId`, `causationId`, `workflowRunId`, `workflowStepRunId`,
`workspaceId`, initiating actor). When supplied AND its workspace matches the
caller's, the agent run **inherits** that chain instead of minting a new root, so
the nested agent execution and all downstream AI-runtime signals share the
WorkflowRun correlation id (backwards-compatible: no option → fresh root, exactly
as before). The context is **never** derived from client input — only trusted
server-side callers (the WorkflowRuntime capability adapter) pass it; a
foreign-workspace context is ignored, and the client request schema has no
correlation field, so a client can never select or inject a correlation id.
`ExecutionContext.causationId` (platform) preserves parent/child depth.

### D-608 · At-least-once trigger deduplication via an atomic claim (correction)

A triggered run has a stable, server-derived trigger key
(`workspace:version:triggerType:occurrenceId`, from the source signal id /
schedule tick / manual idempotency key). `WorkflowRepository.claimTrigger` is an
atomic check-and-set that prevents two runs for the same occurrence; it maps onto
a durable `INSERT … ON CONFLICT DO NOTHING` on a unique `(workspace_id,
trigger_key)`. Resume is idempotent (completed nodes skip by node id) and a
decided approval cannot be re-decided — so at-least-once delivery, duplicate
resume, and duplicate approval are all safe, without relying on callback timing.

## Release confirmations (2026-07-29 — v0.6.0)

Confirmed by the product owner at the Sprint 6 release:

- **D-601/D-602/D-603/D-604/D-606 approved** — WorkflowRuntime is a peer of the AI
  runtime (platform + ports only, never AI/services/persistence/UI directly);
  history is Signal-derived (checkpoints are execution state only, no parallel
  history subsystem); conditions are a validated AST (no eval/dynamic execution);
  resumability via immutable checkpoints + pinned versions + idempotent nodes;
  dev in-memory persistence behind repository/sink interfaces (production
  durability deferred to Sprint 6.5).
- **D-605 approved as an explicit temporary limitation** — owner-scoped execution
  is acceptable for the personal-workspace dev model; **TD-33 stays open**; the
  architecture must not hardcode assumptions blocking future service identities,
  delegated actors, team workspaces, or role-aware execution.
- **Correction 1 (D-607) — nested correlation** implemented: workflow-triggered
  agent runs + all downstream AI-runtime signals inherit the WorkflowRun
  correlation id via a trusted server-side context; client injection impossible;
  the nested-correlation portion of TD-33 is closed.
- **Correction 2 (D-608) — trigger deduplication** implemented: atomic
  `claimTrigger` prevents duplicate runs for the same trigger occurrence.
- **Authoring boundary confirmed** — validated JSON is the current advanced
  authoring surface; no visual builder this release (TD-32 open); the immutable
  version format is builder-agnostic (no future migration).
- **Release.** `sprint-6-workflows` reconciled with `main` and merged
  **non-fast-forward** (history preserved), tagged **v0.6.0**; `v0.5.5` and all
  earlier tags unchanged.

## Release confirmations (2026-07-27 — v0.5.5)

Confirmed by the product owner at the Sprint 5.5 release:

- **D-551 approved** — `lib/platform` is the canonical owner of all AI-agnostic
  runtime primitives; AI may no longer own infrastructure intended for reuse by
  other runtimes.
- **D-552 approved** — dependency direction is permanently `Feature → Platform →
AI (optional)`; the platform must never import AI, Signals, Services, App, or
  any feature domain.
- **D-553 approved** — payload-generic background contracts are the correct
  abstraction; future `WorkflowRuntime`/`NotificationRuntime`/`IntegrationRuntime`/
  `Scheduler` implementations consume them unchanged.
- **D-554 approved** — public compatibility via re-exports is retained; existing
  imports stay stable until a future cleanup sprint.
- **Correlation ownership approved** — correlation is a platform concern
  (`lib/platform/correlation`); Signals consume it rather than owning it.
- **AI accounting ownership approved** — token usage and cost estimation remain
  AI-specific (`lib/ai/runtime/accounting`); the platform must never become aware
  of AI token concepts.
- **Release.** `sprint-5.5-platform-runtime` merged into `main` with a
  **non-fast-forward** merge (history preserved) and tagged **v0.5.5**; `v0.5.0`
  and all earlier tags are unchanged.

## Release confirmations (2026-07-25 — v0.5.0)

Confirmed by the product owner at the Sprint 5 release:

- **D-501 approved — Signals remain additive.** `OperationActivity`,
  `AgentActivity`, and the `ExecutionLogger` stay intact until a future migration
  sprint; **TD-23** stays open until every timeline is migrated to the shared
  Signal timeline engine.
- **D-503 / D-504 approved — the `ExecutionRuntime` is an event producer.** It
  must continue to depend only on the `SignalPublisher` abstraction, and must
  never couple directly to `SignalBus` or persistence.
- **D-507 approved — authentication failures remain `system`-scoped.** They must
  never leak user identity, credentials, or tenant information; a tenant workspace
  must never receive another tenant's authentication telemetry.
- **D-506 approved — notifications remain interface-only.** No delivery channels
  until the Notifications sprint.
- **Release.** `sprint-5-signals-observability` merged into `main` with a
  **non-fast-forward** merge (history preserved, not squashed) and tagged
  **v0.5.0**; `v0.4.5` and all earlier tags are unchanged.

## How to use this log

- Add a dated, numbered entry (`D-2xx`) when a non-obvious choice is made.
- Promote a decision to a full ADR under `docs/adr/` when it becomes foundational
  or needs the Context/Consequences/Alternatives treatment.
- Decisions are append-only; supersede rather than rewrite.
