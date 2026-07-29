# Changelog

All notable changes to CommandOS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Narrative, per-sprint notes live in [`RELEASE_NOTES.md`](./RELEASE_NOTES.md);
this file is the terse, versioned log.

## [Unreleased]

Sprint 6.5 — **Production Foundation** (on `sprint-6.5-production-foundation`; not
merged, not tagged). Production-capable Postgres persistence + durable execution
behind every existing interface — **infrastructure only; no feature behavior
changes** (the dev in-memory path stays the default unless explicitly enabled).

### Added

- **Durable execution engine**: a leased job store
  (`LeasedJobStore = ExecutionQueue + JobStore + Scheduler` + leasing) with atomic
  claim, lease renewal, expiry recovery, retry/backoff, timers, and schedule
  claiming. The `InMemoryLeasedJobStore` mirrors the Postgres semantics so leasing
  is unit-tested deterministically; a **stateless `LeasedBackgroundWorker`**
  (`tick()`) drains a batch per invocation and emits heartbeat/job Signals.
- **Worker endpoint** `POST/GET /api/worker` (Vercel Cron `* * * * *`, guarded by
  `CRON_SECRET`) — the stateless durable-execution driver.
- **Complete PostgreSQL schema** (`supabase/migrations/`): all tables
  (tenancy/operations/agents/execution-logs/signals/workflows + durable-execution
  primitives) with FKs, indexes (incl. partial), unique constraints, **append-only
  - immutable-version + auto-timestamp triggers**, an atomic `claim_jobs`
    (`FOR UPDATE SKIP LOCKED`) function, and **RLS** with service-role boundaries.
    Rollback + seed + `config.toml`.
- **Production adapters — every persistence interface** now has a Postgres
  implementation behind the gate: `SupabaseOperationsRepository`,
  `SupabaseAgentRepository`, `SupabaseWorkflowRepository` (+ `WorkflowRunSink`),
  `SupabaseExecutionLogger`, `SupabaseSignalEventStore` (append-only),
  `SupabaseSignalSubscriptionRepository`, and `SupabaseLeasedJobStore` (durable
  queue) — plus a new `SignalSubscriptionRepository` interface (+ in-memory) and
  `operation_activity`/`agent_activity` tables. A **service-role Supabase client**
  and config-gated wiring (`isSupabasePersistenceEnabled()` — in-memory otherwise;
  server-only adapters lazy-required). Repository + job-store **contract tests**
  run against the in-memory impls; the Supabase runs are gated on
  `SUPABASE_TEST_URL`. Operational runbook: `docs/operations-runbook.md`.
- **Observability**: Health gains `database`/`queue`/`worker` subsystems; worker
  heartbeat + queue stats; `worker.heartbeat`/`job.completed`/`job.failed` catalog
  entries.
- **Adapter-contract harness** (`tests/unit/support/job-store-contract.ts`) run
  against the in-memory store; the Supabase run is gated on `SUPABASE_TEST_URL`.
  Docs: `docs/persistence.md`, `docs/database.md`, `docs/worker.md`,
  `docs/supabase.md`. 15 net-new tests.
- **Portable production-validation package** — the release gate for the Postgres
  path. Fail-closed env validator, migration rollback/replay reversibility check,
  reproducible perf-fixture generator, `EXPLAIN (ANALYZE, BUFFERS)` runner, and a
  report/gate aggregator (`scripts/validation/*`); database-backed integration
  suites (`tests/integration/{database,adapters,worker,rls,concurrency,recovery,
production-smoke}.test.ts`) run only via `vitest.integration.config.ts` (never in
  `npm test`); a manual `production-validation` GitHub Actions workflow (local
  Supabase stack or isolated hosted project); npm scripts (`validate:production`,
  `db:*`, `test:integration:*`, `test:production:smoke`, `test:performance:database`).
  Authored but **not yet executed** — no live database on the build host. Docs:
  `docs/production-validation.md`.

### Changed

- Platform `Job` gains `maxAttempts`/`leaseUntil`/`leaseWorker` (additive);
  `ExecutionContext` unchanged. No public interface redesigned.

> **Not released — release gated on live validation (TD-34, D-656).** All
> production adapters are complete, but the build host has no database, so the
> Supabase migration/rollback/replay, adapter-contract, RLS, concurrency,
> lease/recovery, failure-injection, `EXPLAIN ANALYZE`, and live production smoke
> suites are written/gated but **not executed**. Sprint 6.5 stays on its branch
> (not merged, not tagged) until validated against a provisioned Supabase project.
> All runnable gates + the in-memory durable-execution + repository/job-store
> contract suites pass.

## [0.6.0] — 2026-07-29

Sprint 6 — **Workflows & Automation Platform**. Declarative, versioned automation
graphs that orchestrate Operations, Agents, the AI runtime, and Signals — built on
the completed platform foundation.

### Added

- **Workflow domain** (`lib/workflows`): `Workflow` (draft → active ⇄ paused →
  archived), immutable versioned `WorkflowVersion` graphs, 13 node types
  (`start`/`condition`/`branch`/`parallel`/`join`/`delay`/`approval`/`agent_run`/
  `operation_create`/`operation_transition`/`emit_signal`/`set_variable`/`end`),
  `WorkflowRun`/`WorkflowStepRun`/`WorkflowApproval`, definition + run + step state
  machines, Zod schema + `validateGraph` referential integrity.
- **Condition engine** — a safe, structured boolean expression (no `eval`); and a
  **variable/execution-context engine** (typed seed, `{{var}}` interpolation,
  bounded JSON-safe values).
- **`WorkflowRuntime`** (`lib/workflows/runtime`): a graph orchestrator that
  checkpoints each step, fans out/joins, suspends at approvals/delays and
  **resumes** (idempotent by node id), with retries + timeouts + cancellation from
  the **Platform Runtime** and correlated `workflow.*` Signals. Consumes only the
  platform + injected capability/sink **ports** — never `lib/ai` or services
  directly.
- **Trigger engine**: signal-triggered (bus subscription, workspace-scoped, with a
  self-trigger guard), scheduled (in-process registry + `runDueSchedules`), and
  manual runs.
- **`WorkflowService`** + dev in-memory `WorkflowRepository` (behind an interface):
  CRUD + versioning, RBAC + workspace scoping, start/cancel/resume, approvals.
- **Signal integration**: 17 `workflow.*` signal types; a run's **audit history is
  reconstructed from Signals** (no bespoke history table) via the Timeline Engine.
- **Workflow surfaces**: `/console/workflows` (list + create-from-template),
  definition detail (versions, runs, lifecycle + run controls), run detail
  (signal-derived timeline, step checkpoints, variables, approval/cancel controls);
  `/api/workflows` palette feed; ⌘K + nav entries.
- Docs: `docs/workflows.md`, `docs/workflow-runtime.md`. 21 net-new tests
  (domain, conditions, variables, schema, state machines, runtime — linear /
  conditions / parallel+join / approval suspend+resume / delay / agent
  orchestration / retry / failure — service, signal + scheduled trigger
  integration, signal-derived history + correlation, command registration).

- **Nested correlation** (D-607): `AgentService.execute` accepts an optional
  trusted, server-side `correlation` context; a workflow-triggered agent run and
  all downstream AI-runtime signals inherit the WorkflowRun correlation id (a
  standalone run still mints a fresh root; client injection is impossible;
  `ExecutionContext.causationId` preserves parent depth).
- **At-least-once trigger deduplication** (D-608): a stable server-derived trigger
  key + an atomic `WorkflowRepository.claimTrigger` prevent duplicate runs for the
  same signal/schedule/manual occurrence (durable-constraint-compatible); resume
  and approval decisions are idempotent.

### Changed

- Added a `workflows` Signal source + catalog entries; the empty `system` command
  group and nav gain workflow entries. Added a prototype-pollution guard on
  workflow variable keys.

## [0.5.5] — 2026-07-27

Sprint 5.5 — **Platform Runtime**. An architectural refactor: promote the
reusable, AI-agnostic runtime primitives out of the AI runtime into a shared
platform layer so Workflows, Notifications, Scheduling, Background Execution, and
future subsystems depend on a common foundation. **No user-facing features;
application behavior is identical.**

### Changed

- **New `lib/platform/`** owns the domain-neutral primitives: `RetryPolicy` +
  `runWithRetry` (moved from `lib/ai/runtime/retry`), cancellation (moved from
  `lib/ai/runtime/cancellation`), execution identifiers (`ids.ts`), correlation
  helpers (`correlation.ts`), the generic execution status machine + context +
  events (`execution.ts`), and the background/queue/worker/scheduler/job-store
  contracts (`background.ts`).
- **Dependency direction enforced:** `Feature → Platform → AI (optional)`.
  `lib/platform/**` imports nothing from `lib/ai`, `lib/signals`, `services`, or
  `app` (verified). The AI `ExecutionRuntime` now **consumes** the platform.
- **Background contracts generalized:** the queue/worker/scheduler/job-store
  interfaces are now payload-generic (`Job<T>` tagged by `kind`) instead of being
  coupled to the AI `ExecutionRequest`/`Execution`, so a future `WorkflowRuntime`/
  `NotificationRuntime` consumes them without modification (interface-only, TD-19).
- **Contracts preserved:** `@/lib/ai/runtime/execution` re-exports the generic
  primitives; the AI runtime barrel re-exports platform retry/cancellation for
  convenience; `@/lib/signals/correlation` re-exports `rootCorrelation`/
  `continueChain` and builds `childOf`/`groupByCorrelation` on the platform.
- New design doc `docs/platform-runtime.md`; 7 net-new platform tests (ids,
  correlation, execution status machine, generic `Job` shape). All prior tests
  pass unchanged (203 total).

## [0.5.0] — 2026-07-25

Sprint 5 — **Signals & Observability Platform**. The platform-wide event and
observability system: every subsystem now emits **Signals**, the canonical event
model. Emission is additive
and behavior-preserving — existing Operations/Agents/runtime behavior, the
per-feature activity timelines, and the execution logger are unchanged.

### Added

- **Signal domain** (`lib/signals`): append-only `Signal` + `SignalEvent`
  (acknowledgement/resolution is projected from appended events — the emitted
  record is never mutated), with `SignalSource`/`SignalSeverity`/`SignalCategory`/
  `SignalStatus`/`SignalResolution`/`SignalCorrelation`/`SignalSubscription`/
  `SignalFilter`. A signal-type **catalog**, a `createSignal` factory with
  **payload sanitization** (redacts secret/prompt keys; bounds size/depth), and
  shared filter/subscription matching.
- **SignalBus** (`lib/signals/bus.ts`): reusable in-process publish/subscribe with
  filtered fan-out, failure isolation + health, and a narrow `SignalPublisher`
  seam so emitters never depend on consumers. A future distributed bus implements
  the same interface.
- **Append-only SignalEventStore** (`lib/signals/store.ts`) + dev in-memory impl;
  the shared bus/store/publisher are wired in `lib/signals/index.ts` with a
  built-in persistence subscriber.
- **Correlation tracking** (`lib/signals/correlation.ts`): one correlation id
  threads a whole execution chain (agent run → runtime → provider → retry →
  completion); every emitted signal preserves it automatically.
- **Timeline engine** (`lib/signals/timeline.ts`), **metrics** (`metrics.ts` —
  execution counts/success/failure/retry/timeout/cancel, duration, provider
  latency, tokens, cost, throughput, severity/source/category counts), **health**
  (`health.ts` — provider/runtime/signal-bus → healthy/warning/degraded/
  unavailable/unknown), all computed from signals.
- **Notification framework** (`lib/signals/notification.ts`): interfaces only
  (`NotificationChannel`/`Message`/`Dispatcher`/`Subscription`/`Rule`) — no
  delivery, no channel implementations.
- **`SignalsService`** (`services/signals`): workspace-scoped list/get/timeline/
  correlations/metrics/health/acknowledge/resolve; every query forcibly scoped to
  the caller's workspace.
- **Emission** wired additively into Operations, Agents, the `ExecutionRuntime`
  (execution lifecycle signals, correlated), auth (succeeded/failed), the command
  palette (`command.executed`), workspace switch, and permission denials.
- **Signals surface** (`/console/signals` + `/console/signals/[id]`): health
  overview, metrics summary, faceted filters, activity feed, correlation view,
  signal detail with payload + append-only lifecycle + subject timeline; loading
  and error boundaries. Workspace-scoped `/api/signals` palette feed; ⌘K actions
  (view/filter signals, runtime & provider health, correlations).
- Four design docs: `docs/signals.md`, `docs/signal-bus.md`, `docs/observability.md`,
  `docs/timeline-engine.md`. 51 net-new tests (domain/lifecycle, bus, store,
  timeline, correlation, metrics, health, service + workspace isolation, and a
  feature/provider/execution integration suite).

### Changed

- `ExecutionContext` carries an optional `correlationId`; the `ExecutionRuntime`
  accepts an optional `SignalPublisher` and emits correlated execution signals.
  `OperationsService`/`AgentService` accept an optional publisher (no-op by
  default — existing tests and behavior are unchanged). The empty `system`
  command group now holds the real signal observability commands.

## [0.4.5] — 2026-07-25

Sprint 4.5 — **AI Runtime & Platform Foundation**. No new end-user features — a
reusable AI execution platform, with agents refactored onto it and behavior
unchanged. `ModelProvider` and `ExecutionRuntime` are the canonical AI platform
contracts. Streaming, MCP, queues, background workers, schedulers, and job stores
remain **contracts only**; in-memory execution logging and feature persistence
remain **development-only** (TD-18, TD-19, TD-20 open).

### Added

- **Execution runtime** (`lib/ai/runtime`): a generic `ExecutionRuntime` that
  owns the provider call, retry, timeout, cancellation, token/cost accounting,
  structured-output validation, lifecycle events, and secret-free logging.
  Domain model — `Execution`, `ExecutionRequest`, `ExecutionContext`,
  `ExecutionResult`, `ExecutionMetadata`, `ExecutionError`, `ExecutionEvent` — and
  a `queued → pending → running → {completed,failed,cancelled,timed_out}` status
  machine supporting future async/scheduled/autonomous execution.
- **Provider layer** (`lib/ai/provider`): a generic `ModelProvider` abstraction
  with separated concerns (provider/model/config/structured-output/streaming),
  a server-only `OpenAIModelProvider`, and a deterministic `FakeModelProvider`.
  Model selection stays server-side; streaming is interface-only.
- **Conversation model** (`lib/ai/conversation`): `SystemPrompt` (trusted) /
  `UserInput` (untrusted) / `Conversation` / `ContextWindow` — the trust boundary
  enforced by construction.
- **Prompt engine** (`lib/ai/prompts`): versioned, strongly-typed, composable
  templates + `PromptRegistry`; the agent system prompts moved onto it.
- **Tool framework** (`lib/ai/tools`): `Tool` / `ToolRegistry` / `ToolDefinition`
  / `ToolInvocation` / `ToolResult` / `ToolError`, three demo tools, and
  MCP-readiness interfaces.
- **Retry policies** (`no/fixed/exponential`), **cancellation** (`AbortSignal`),
  **accounting** (token/cost), **execution logging**, and **background-execution
  interfaces** (queue/worker/scheduler/job store) — the last defined only.
- Four new design docs: `docs/ai-runtime.md`, `docs/runtime.md`,
  `docs/execution-model.md`, `docs/tool-framework.md`.
- 31 net-new platform tests (runtime, provider, conversation, prompt engine,
  tools, retry, accounting, execution model).

### Changed

- `AgentService` executes through the `ExecutionRuntime` instead of an inline
  provider call — the duplicated AI mechanics are gone; behavior is unchanged.
- Replaced the Sprint-4 agent-specific `AIProvider`/`AIProviderError`/
  `buildInvocation`/`systemPromptFor` with the generic platform equivalents;
  moved the agent result schema to `lib/agents/result-schema.ts`.

## [0.4.0] — 2026-07-25

Sprint 4 — **Agents & AI**. The Agents vertical slice with an AI execution
workflow behind a provider interface, on the development in-memory store. _(The
provider boundary is superseded by the Sprint 4.5 `ModelProvider`/`ExecutionRuntime`
platform; agent behavior is unchanged.)_

### Added

- Agent domain: workspace-scoped `Agent` (type, capabilities, instructions,
  audit fields), a management lifecycle state machine (`draft → active ⇄ paused`,
  `→ disabled → active`, `→ archived`), an immutable `AgentActivity` timeline, and
  `AgentExecution` records with a structured, validated result.
- `AgentRepository` interface + labelled **development-only in-memory
  implementation**; `AgentService` owning validation, RBAC + ownership, lifecycle
  enforcement, workspace scoping, execution orchestration, and activity.
- AI provider boundary (`lib/ai`): `AIProvider` interface, an OpenAI adapter
  (server-only, centralized model selection, strict structured output, timeout,
  safe errors) and a deterministic `FakeAIProvider` for tests. Model calls never
  originate in UI; operator content never enters the trusted system prompt.
- Agent surfaces: list, detail (run interface, run history, lifecycle controls,
  activity), create, and edit — plus loading and error boundaries and honest
  loading / empty / unavailable / error / success / not-found / permission-denied
  states. AI-generated content is rendered as text only.
- Server Actions for create, edit, transition, and run (the run returns the
  completed/failed execution inline — never a fabricated success).
- Workspace-scoped `/api/agents` (and now `/api/operations`) palette feeds; ⌘K
  actions to create, find, open, and run agents.
- **TD-13 resolved**: command-palette queries are keyed and requested by the
  active workspace, so a workspace switch never surfaces stale results.
- shadcn `textarea` reuse; shared `lib/authz/roles` and
  `services/workspace/context` (operations refactored onto them).
- 55 unit/component tests (state machine, permissions, schema, repository,
  service + execution scenarios, AI provider boundary, missing config, timeout,
  failure, invalid output, command registration, workspace-scoped palette, and
  the agent form).

### Changed

- The `create.operation` / `create.agent` palette actions open their create
  forms; the Sprint-1 `agent.dispatch` placeholder was retired.
- `OperationsContext` / operations context now alias the shared workspace context.

## [0.3.0] — 2026-07-25

Sprint 3 — **Operations**. The complete Operations vertical slice on a
development in-memory store, behind the repository/service boundaries. Persistence
remains in-memory until the planned Supabase persistence sprint (deferral approved
at the pre-merge review).

### Added

- Workspace-scoped `Operation` domain model (title, description, priority,
  lifecycle status, audit fields) and an immutable `OperationActivity` timeline.
- Lifecycle state machine transcribed from `33_STATE_MACHINE_SPECIFICATION.md`:
  `draft → planned → in_progress ⇄ blocked`, `in_progress → completed → archived`.
  Invalid transitions are rejected; every transition is recorded as activity.
- `OperationsRepository` interface with a labelled **development-only in-memory
  implementation** (the Supabase adapter is deferred with the operations migration).
- Operations service layer: use cases with Zod validation, RBAC + ownership
  permissions, lifecycle enforcement, and workspace scoping.
- Server Actions for create, edit, and status transition (revalidation +
  redirects); all authorization and validation enforced server-side.
- Operations surfaces: list (with empty state), detail (with activity timeline
  and lifecycle controls), create, and edit — plus loading and error boundaries.
- ⌘K command-palette actions to create, find, and open operations (live feed via
  TanStack Query against a new workspace-scoped `/api/operations` route).
- shadcn `textarea` primitive.
- 44 unit/component tests (state machine, permissions, schema, repository,
  service workflows incl. cross-workspace isolation, command registration, and
  the operation form).

### Changed

- The `Operation` type and `OperationsRepository` interface were replaced (the
  Sprint-0 `{id,title,status}` scaffold → the full workspace-scoped model).
- The `create.operation` palette action now opens `/console/operations/new`.

## [0.2.0] — 2026-07-24

Sprint 2 — **Auth & Workspaces**. CommandOS gains identity: operators sign in,
the console is protected, and every operator works within a workspace.

### Added

- Supabase-backed authentication: email/password + OAuth (Google, GitHub)
  sign-in / sign-up / sign-out, with client validation (React Hook Form + Zod)
  and server actions that re-validate against the same schema.
- OAuth / email-confirmation callback (`app/auth/callback`) that exchanges the
  PKCE code for a session, guarded against open redirects.
- Route protection in middleware — unauthenticated operators are bounced from
  `/console/*` to `/login`, authenticated operators away from `/login` — plus a
  defense-in-depth guard in the console layout. All gating is skipped when
  Supabase is unconfigured, so local dev still runs.
- Request-memoized session access in RSC via `getCurrentUser()`, projecting the
  Supabase user onto a typed `AuthUser`.
- Workspace model: `Workspace` type, `WorkspaceRepository` interface, and a real
  `PersonalWorkspaceRepository` (one workspace derived per operator — no
  placeholder rows). Workspace context provider + switcher in the shell.
- Operator menu (avatar, identity, sign-out) and a real account/workspace
  Settings surface.
- shadcn UI primitives: `input`, `label`, `avatar`, `dropdown-menu`.

### Changed

- Settings is now a real surface (previously a roadmap placeholder).
- The Supabase server client no longer depends on unrelated secrets (OpenAI,
  service role); it builds from the two public Supabase keys via
  `supabasePublicConfig()`.
- Console routes are `force-dynamic` so session state is never served statically.

### Fixed

_Pre-merge review hardening (behavior-preserving):_

- Middleware redirects now carry the auth cookies refreshed by `getUser()` onto
  the redirect response, preventing session loss and token-refresh loops.
- Callback `next` redirect guard rejects protocol-relative (`//host`) and
  backslash (`/\host`) targets; only same-origin relative paths are honored.
- Auth form accessibility: field errors linked via `aria-describedby`, the status
  banner is a live region (`role`/`aria-live`), and OAuth buttons keep an
  accessible label while their spinner shows.
- Workspace resolution deduplicated behind `getWorkspaceContext()` (shared by the
  console layout and settings).
- The app-origin lookup reads `NEXT_PUBLIC_APP_URL` through `lib/env`
  (`configuredAppUrl()`) instead of touching `process.env` in feature code.

## [0.1.0] — Sprint 1 · Command Surface & Shell

### Added

- Global ⌘K / Ctrl-K command palette (cmdk), mounted app-wide.
- Typed, route-safe command registry (`lib/commands/registry.ts`).
- Console shell (navigation rail + command bar + content region) with an
  animated, reduced-motion-correct active-nav indicator.
- Console routes: `/console` plus `agents`, `signals`, `operations`, `settings`.
- shadcn `dialog` + `command` primitives; wired landing CTAs.

### Changed

- Landing action buttons are now functional (previously static).

## [0.0.0] — Sprint 0 · Foundation

### Added

- Next.js 15 (App Router) + React 19 + strict TypeScript scaffold.
- Tailwind CSS v4 + shadcn/ui with the CommandOS design language (OKLCH tokens).
- Tooling (ESLint flat config, Prettier, Husky + lint-staged), testing (Vitest,
  Testing Library, Playwright), infra adapters (Supabase SSR, OpenAI server-only,
  Zod-validated env), and state management (TanStack Query, Zustand).

[Unreleased]: https://github.com/JCFrith/CommandOS/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/JCFrith/CommandOS/releases/tag/v0.6.0
[0.5.5]: https://github.com/JCFrith/CommandOS/releases/tag/v0.5.5
[0.5.0]: https://github.com/JCFrith/CommandOS/releases/tag/v0.5.0
[0.4.5]: https://github.com/JCFrith/CommandOS/releases/tag/v0.4.5
[0.4.0]: https://github.com/JCFrith/CommandOS/releases/tag/v0.4.0
[0.3.0]: https://github.com/JCFrith/CommandOS/releases/tag/v0.3.0
[0.2.0]: https://github.com/JCFrith/CommandOS/releases/tag/v0.2.0
