# Changelog

All notable changes to CommandOS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Narrative, per-sprint notes live in [`RELEASE_NOTES.md`](./RELEASE_NOTES.md);
this file is the terse, versioned log.

## [Unreleased]

_Nothing yet._

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

[Unreleased]: https://github.com/JCFrith/CommandOS/compare/v0.4.5...HEAD
[0.4.5]: https://github.com/JCFrith/CommandOS/releases/tag/v0.4.5
[0.4.0]: https://github.com/JCFrith/CommandOS/releases/tag/v0.4.0
[0.3.0]: https://github.com/JCFrith/CommandOS/releases/tag/v0.3.0
[0.2.0]: https://github.com/JCFrith/CommandOS/releases/tag/v0.2.0
