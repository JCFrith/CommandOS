# PROJECT_STATUS

_Last updated on the `sprint-6-workflows` branch (not merged, not tagged)._

## Current Sprint

**Sprint 6 — Workflows & Automation Platform** 🚧 implemented on
`sprint-6-workflows` (not merged, not tagged). Declarative, versioned automation
graphs (`WorkflowRuntime`) that orchestrate Operations, Agents, the AI runtime,
and Signals — triggered by signals/schedules/manually, with conditions,
branching, parallel+join, delays, approvals, retries, timeouts, cancellation, and
**resumability** via per-node checkpoints. The runtime consumes only the Platform
Runtime + injected ports (never `lib/ai`); run history is reconstructed from
Signals (see `docs/workflows.md`, `docs/workflow-runtime.md`).

**Sprint 5.5 — Platform Runtime** ✅ complete — merged to `main`, tagged
`v0.5.5`. Promotes the reusable, AI-agnostic runtime primitives (retry,
cancellation, ids, correlation, the execution status machine + context + events,
and the background/queue/worker/scheduler/job-store contracts) out of
`lib/ai/runtime` into a shared `lib/platform`. Dependency direction is enforced
`Feature → Platform → AI (optional)`; the AI `ExecutionRuntime` now consumes the
platform. **No user-facing features; behavior is identical** (see
`docs/platform-runtime.md`).

**Sprint 5 — Signals & Observability Platform** ✅ complete — reviewed, merged to
`main`, tagged `v0.5.0`. The platform-wide event and observability system: every
subsystem emits **Signals**, the canonical event model, distributed by a reusable
`SignalBus` into an append-only `SignalEventStore`, with correlation tracking, a
timeline engine, metrics, health, and a subscription engine. Emission is additive
and behavior-preserving.

**Sprint 4.5 — AI Runtime & Platform Foundation** ✅ complete — merged to `main`,
tagged `v0.4.5`. `ModelProvider` and `ExecutionRuntime` are the canonical AI
platform contracts. Sprint 4 — Agents & AI ✅ (`v0.4.0`, `d30711e`) · Sprint 3 —
Operations ✅ (`v0.3.0`, `31df2c7`) · Sprint 2 — Auth & Workspaces ✅ (`v0.2.0`,
`cef73ef`) · Sprint 1 ✅ (`fed69e6`) · Sprint 0 ✅ (`f4809c0`).

> **Release chain:** `v0.4.0` contains Sprint 4 (Agents & AI); `v0.4.5` adds the
> Sprint 4.5 AI runtime platform. Streaming, MCP, queues, background workers,
> schedulers, and job stores remain **contracts only**; in-memory execution
> logging and feature persistence remain **development-only** (TD-18/19/20 open).

## Completed Features

### Sprint 0 — Foundation

- Next.js 15.5.21 (App Router) + React 19 + strict TypeScript scaffold
- Tailwind CSS v4 + shadcn/ui (new-york) tokens; AI-OS design language, dark default (`app/globals.css`)
- Tooling: ESLint (flat config), Prettier, Husky + lint-staged (verified firing), `.npmrc`, `.env.example`
- Infra adapters: Supabase (browser/server/middleware SSR clients), OpenAI (server-only), Zod-validated lazy env (`lib/env.ts`)
- State: TanStack Query provider, Zustand store
- Testing: Vitest + Testing Library, Playwright e2e config + specs
- Directive folder structure; source-of-truth docs (`MASTER_BUILD.md`, `CLAUDE.md`, `/docs`)
- Motion-driven landing surface (`components/os/command-surface.tsx`)

### Sprint 1 — Command Surface & Shell

- Global **⌘K / Ctrl-K command palette** (cmdk) mounted app-wide, wired to the Zustand `command-palette` store
- Typed, **route-safe command registry** (`lib/commands/registry.ts`) with grouped results
- **Console app shell** (`components/os/app-shell.tsx`): navigation rail + command bar + content region, animated active-nav indicator (`layoutId`)
- Real routes: `/console` plus `agents`, `signals`, `operations`, `settings` sections
- Honest section scaffolds (`SectionRoadmapNote`) naming the sprint each feature lands in — no fake functionality
- shadcn `dialog` + `command` primitives; landing CTAs wired (Enter → `/console`, ⌘K opens palette)
- Reduced-motion-correct transitions throughout
- Post-sprint tech-debt cleanup: shared `SystemStatus` component, `useCommandShortcut` hook, removed dead `useMounted`

### Sprint 2 — Auth & Workspaces

- **Supabase auth**: email/password + OAuth (Google, GitHub) sign-in / sign-up / sign-out
- **OAuth callback** (`app/auth/callback/route.ts`) with open-redirect guard
- **Route protection**: middleware (config-gated) + RSC-level guard in the console layout
- **Session in RSC**: `getCurrentUser()` request-memoized, projecting a typed `AuthUser`
- **Workspaces**: `Workspace` model, `WorkspaceRepository` interface + real `PersonalWorkspaceRepository`
- **Workspace context** provider + switcher; operator **UserMenu** with sign-out
- **Settings** surface showing real account + workspace; RHF + Zod auth form
- shadcn primitives added: `input`, `label`, `avatar`, `dropdown-menu`
- Decoupled the Supabase server client from unrelated secrets (`supabasePublicConfig`)
- Console routes `force-dynamic`; unit tests for auth schema + workspace repo

### Sprint 3 — Operations

- **Domain model**: workspace-scoped `Operation` (title, description, priority,
  status, audit fields) + immutable `OperationActivity` timeline (`types/index.ts`)
- **Lifecycle state machine** (`lib/operations/state-machine.ts`) transcribed
  from `33_STATE_MACHINE_SPECIFICATION.md`: `draft → planned → in_progress ⇄ blocked`,
  `in_progress → completed → archived`; invalid transitions rejected
- **Repository boundary** (`OperationsRepository`) with a labelled dev-only
  **in-memory implementation**; Supabase adapter deferred (see roadmap deviation)
- **Service layer** (`operations-service.ts`): use cases with Zod validation,
  RBAC + ownership permissions, lifecycle enforcement, and activity recording
- **Server Actions** (create / update / transition) with revalidation + redirects
- **Routes**: list, detail (+ timeline + lifecycle controls), create, edit
  (`/console/operations`, `/[id]`, `/[id]/edit`, `/new`) + palette feed API
- **Command palette**: create, find, and open operations from ⌘K (live feed via
  TanStack Query → `/api/operations`)
- Loading / empty / error / success states; accessible forms + keyboard nav;
  RSC-first (only forms & transition controls are client components)
- shadcn `textarea` primitive; **43 new unit/component tests**

### Sprint 4 — Agents & AI

- **Domain model**: workspace-scoped `Agent` (type, capabilities, instructions,
  audit fields), management lifecycle state machine (`draft → active ⇄ paused`,
  `→ disabled → active`, `→ archived`; only `active` runs), immutable
  `AgentActivity` timeline, and `AgentExecution` with a structured, Zod-validated
  result (D-401)
- **AI provider boundary** (`lib/ai`): `AIProvider` interface + server-only
  OpenAI adapter (centralized model selection, strict structured output, 30s
  timeout, safe `AIProviderError`) + deterministic `FakeAIProvider` for tests.
  Trusted per-type system prompts; operator content confined to the user message
  (`prompt-builder`) — the prompt-injection boundary (D-402)
- **Repository + service**: `AgentRepository` (dev in-memory, labelled) and
  `AgentService` (validation, RBAC + ownership, lifecycle, workspace scoping,
  synchronous execution with a duplicate-run guard, activity)
- **Execution**: authorized operator runs an active agent → pending/running →
  completed/failed; honest **unavailable** state when OpenAI isn't configured
  (no fabricated success, D-403/D-404)
- **Routes**: list, detail (run interface + run history + lifecycle + activity),
  create, edit (`/console/agents`, `/[id]`, `/[id]/edit`, `/new`) + `/api/agents`
- **Command palette**: create / find / open / run agents; **TD-13 resolved** —
  operations + agents feeds keyed and requested by the active workspace (D-405)
- Loading / empty / unavailable / error / success / not-found / permission-denied
  states; accessible forms + keyboard nav; RSC-first (3 client components);
  AI output rendered as text only
- Shared `lib/authz/roles` + `services/workspace/context` (operations refactored
  onto them); **55 new unit/component tests**

### Sprint 4.5 — AI Runtime & Platform Foundation

_Platform sprint — no new end-user features; existing functionality unchanged._

- **Execution runtime** (`lib/ai/runtime`): generic `ExecutionRuntime` owning the
  provider call, retry, timeout, cancellation, token/cost accounting,
  structured-output validation, lifecycle events, and secret-free logging;
  `Execution*` domain model + `queued→pending→running→{completed,failed,cancelled,
timed_out}` status machine (D-451/452)
- **Provider layer** (`lib/ai/provider`): generic `ModelProvider` (concerns
  separated), server-only `OpenAIModelProvider`, deterministic `FakeModelProvider`;
  model server-side only; streaming interface-only (D-453)
- **Conversation model** (trusted `SystemPrompt` / untrusted `UserInput`) — the
  prompt-injection boundary is structural (D-454)
- **Prompt engine** (versioned, typed, composable templates + registry); agent
  prompts moved onto it
- **Tool framework** (`Tool`/`ToolRegistry`/…) + 3 demo tools + **MCP-readiness**
  interfaces; **background-execution** interfaces (queue/worker/scheduler/job
  store) — interface-only (D-455)
- **Retry** (no/fixed/exponential), **cancellation** (`AbortSignal`),
  **accounting**, **execution logging** — reusable, tested in isolation
- **Agents refactored** onto the runtime — inline AI mechanics removed; behavior
  identical (D-456). Docs: `docs/ai-runtime.md`, `runtime.md`,
  `execution-model.md`, `tool-framework.md`. **31 net-new platform tests**

### Sprint 5 — Signals & Observability Platform

_Platform sprint — additive & behavior-preserving; existing functionality unchanged._

- **Signal domain** (`lib/signals`): append-only `Signal` + `SignalEvent`
  (ack/resolution projected from appended events, never mutated), with
  `SignalSource`/`Severity`/`Category`/`Status`/`Resolution`/`Correlation`/
  `Subscription`/`Filter`; a signal-type catalog; a `createSignal` factory with
  **payload sanitization** (redacts secret/prompt keys; bounds size/depth); shared
  filter + subscription matching (D-502)
- **SignalBus** (`lib/signals/bus.ts`): reusable in-process publish/subscribe —
  filtered fan-out, failure isolation + health, a narrow `SignalPublisher` seam
  (emitters never depend on consumers). Distributed transport fits the same
  interface (D-503)
- **Append-only `SignalEventStore`** + dev in-memory impl; shared bus/store/
  publisher wired with a persistence subscriber (`lib/signals/index.ts`)
- **Correlation** (`lib/signals/correlation.ts`): one id threads a whole run
  chain (agent → runtime → provider → retry → completion); preserved
  automatically on every signal (D-504)
- **Timeline engine** (`timeline.ts`), **metrics** (`metrics.ts`), **health**
  (`health.ts`) — all computed from Signals; honest estimates + `unavailable`
  states, never fabricated (D-505)
- **Notification framework** (`notification.ts`): interfaces only — no delivery,
  no channels (D-506, TD-22)
- **`SignalsService`** (`services/signals`): workspace-scoped list/get/timeline/
  correlations/metrics/health/acknowledge/resolve — every query forcibly scoped
- **Emission** wired additively into Operations, Agents, the `ExecutionRuntime`,
  auth, the command palette, workspace switch, and permission denials
- **Signals surfaces** (`/console/signals`, `/console/signals/[id]`): health,
  metrics, faceted filters, activity feed, correlation view, signal detail with
  payload + append-only lifecycle + subject timeline; `/api/signals` palette feed;
  ⌘K signal/health/correlation actions
- Four design docs (`docs/signals.md`, `signal-bus.md`, `observability.md`,
  `timeline-engine.md`); **51 net-new tests**

## Build Status

| Gate                | Result                                                                |
| ------------------- | --------------------------------------------------------------------- |
| `npm run lint`      | ✅ No ESLint warnings or errors                                       |
| `npm run typecheck` | ✅ `tsc --noEmit` clean                                               |
| `npm run build`     | ✅ compiled; 20 app routes (+`/api/signals`, `/console/signals/[id]`) |

Runtime smoke (Sprint 4.5): existing routes render unchanged (`/console/agents`,
`/console/agents/new`, `/api/agents`, `/console/operations`, `/api/operations`,
`/console/settings` → 200 — no regression). The platform is exercised in a single
realm via an in-process walkthrough driving the **real `ExecutionRuntime` +
`FakeModelProvider`**: structured output + accounting, invalid-output failure,
retry-to-success (attempts counted), timeout (`timed_out`), cancellation
(`cancelled`), and the refactored `AgentService` run (completed / honest
unavailable) — all pass.

## Test Status

| Suite            | Result                                                     |
| ---------------- | ---------------------------------------------------------- |
| Unit (Vitest)    | ✅ 233 passing across 43 files (21 net-new for Workflows)  |
| E2E (Playwright) | Configured; `home.spec.ts` present (not run in this cycle) |

Runtime smoke (Sprint 5): an in-process walkthrough drives the **real wired
`SignalBus` + append-only `SignalEventStore` + `SignalsService`** with feature
services over a `FakeModelProvider` — 23 checks pass: operations/agents/runtime
emission → persistence → read path, execution-chain **correlation** (one id),
timeline + correlation view, metrics (1 completed run, 100% success, tokens not
redacted), health (provider/runtime healthy, honest provider `unavailable` signal
separately), **permission-denied** emission, provider-unavailable (no fabricated
run), and **workspace isolation** (another workspace sees none; cross-workspace
get blocked).

## Technical Debt Audit (post-Sprint 1)

Behavior-preserving review across the requested dimensions. **Fixed** items were
low-risk and applied; **retained** items are intentional and documented.

| Area                   | Finding                                                              | Action                                                            |
| ---------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Folder structure       | Matches the directive/architecture; layering respected.              | ✅ No change needed.                                              |
| Naming consistency     | kebab-case files, PascalCase components, `use-*` hooks — consistent. | ✅ No change needed.                                              |
| Component organization | `ui` (primitives) vs `os` (product) split is clean.                  | ✅ No change needed.                                              |
| Duplicated code        | "systems nominal" indicator duplicated in landing + console bar.     | **Fixed** — extracted `components/os/system-status.tsx`.          |
| Duplicated code        | ⌘K keydown effect inline in `command-menu`.                          | **Fixed** — moved to `hooks/use-command-shortcut.ts`.             |
| Unused code            | `hooks/use-mounted.ts` had zero importers (dead).                    | **Fixed** — removed; `hooks/` now holds the used shortcut hook.   |
| Unused dependencies    | `react-hook-form` + `@hookform/resolvers` not yet imported.          | ✅ Resolved in Sprint 2 — now power the auth form.                |
| Premature abstractions | `OperationsRepository` + `Operation` types have no implementer yet.  | Retained — documented persistence boundary; implemented Sprint 3. |
| Simplification         | No further safe simplifications without changing behavior.           | ✅ Deferred to feature sprints.                                   |

## Outstanding Issues

- `next lint` prints a deprecation notice (removed in Next.js 16). Non-blocking; migrate to the ESLint CLI (`@next/codemod next-lint-to-eslint-cli`) in a future chore.
- `npm audit` reports transitive advisories from dev/build deps; no known impact on the app. Review before production.
- Native install scripts (esbuild, sharp) run under npm allow-scripts warnings in this environment; builds/tests succeed regardless.
- Action commands (`New Operation`, `Dispatch an Agent`) currently navigate to their section carrying an `intent` query param; the actual create/dispatch flows land in Sprints 3 and 4.
- Playwright e2e not executed this cycle (requires a build+serve run).
- `OperationsRepository` interface + `Operation` types are declared with no implementer yet; the Supabase implementation lands in Sprint 3.
- **Live auth requires Supabase credentials.** Sign-in/up/OAuth were verified by build + unit tests + a render smoke test; end-to-end auth against a real Supabase project is untested here. OAuth providers must be enabled in the Supabase dashboard with `<APP_URL>/auth/callback` allow-listed.
- Only the personal workspace exists; shared team workspaces (Supabase-backed) are a later sprint. The switcher's "New workspace" is intentionally disabled.

## Pre-merge Architecture Review — `sprint-2-auth-workspaces`

Reviewed all 31 changed files across the requested dimensions. Clean scan: no
`getSession` misuse (uses `getUser`), no `console.*`/`debugger`, no `any` /
`ts-ignore`. Six **low-risk fixes applied** (behavior-preserving); the rest
reviewed as correct.

| Dimension                     | Finding                                                                                                                                           | Action                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Supabase SSR / middleware     | Redirect branches returned a bare `NextResponse.redirect`, dropping auth cookies refreshed by `getUser()` → possible session loss / refresh loop. | **Fixed** — `redirectTo()` copies refreshed cookies onto redirects.                                                      |
| Accessibility                 | Field errors not linked to inputs; status banner not a live region; OAuth buttons lose label while spinning.                                      | **Fixed** — `aria-describedby` + ids, `role`/`aria-live`, `aria-label`.                                                  |
| Duplicated logic              | `user → listForUser → workspaces[0]` duplicated in console layout + settings.                                                                     | **Fixed** — extracted `getWorkspaceContext()` (+2 unit tests).                                                           |
| Security / open redirect      | Callback `next` guard allowed `//host` and `/\host` (protocol-relative) targets, which browsers can resolve cross-origin.                         | **Fixed** — guard now rejects `//` and `/\` prefixes; only same-origin relative paths pass.                              |
| Conventions (env access)      | `origin()` read `process.env.NEXT_PUBLIC_APP_URL` directly, against the "go through `lib/env`" rule.                                              | **Fixed** — added `configuredAppUrl()` in `lib/env`; Host-header fallback retained (Supabase allow-lists redirect URLs). |
| RSC violations / client comps | All `'use client'` components justified (forms, Radix primitives, interactivity); `input` stays server-renderable.                                | ✅ No change needed.                                                                                                     |
| Hydration risks               | `WorkspaceProvider` seeds `useState` from props deterministically; no `Date`/random.                                                              | ✅ No change needed.                                                                                                     |
| Error handling                | `redirect()` correctly outside try/catch; actions guard unconfigured state and surface errors.                                                    | ✅ No change needed.                                                                                                     |
| TypeScript / performance      | `getCurrentUser` memoized via React `cache` (layout+page share one round-trip); typed throughout.                                                 | ✅ No change needed.                                                                                                     |

> All four gates (`lint` / `typecheck` / `build` / `test`) pass on the
> post-review tree. Runtime smoke against a live Supabase project is deferred to
> a configured environment (unconfigured local dev bypasses auth by design).

## Sprint 3 Review & Known Limitations

Reviewed at the initial Sprint 3 commit and again at the **pre-merge review**
(2026-07-25) across every requested dimension (lifecycle correctness, workspace
isolation, permission enforcement, boundary integrity, coupling to the in-memory
impl, security, validation/error handling, a11y + keyboard nav, RSC boundaries,
unnecessary client components, hydration, duplication, dead code, premature
abstraction, test quality, convention consistency).

**Pre-merge verification (all pass):**

1. No UI component imports/instantiates the in-memory repository — it is
   referenced only by `operations-service.ts` (default binding) and the tests.
2. Domain/service tests are UI-free (only `operation-form.test.tsx` uses RTL).
3. Workspace-scoped reads **and writes** cannot cross boundaries — every repo
   call is scoped by `ctx.workspace.id`; writes derive from a workspace-scoped
   `get` (cross-workspace update/transition/activity → `not_found`, now tested).
4. Invalid transitions are rejected in the service (`canTransition` guard) and
   the UI only offers server-computed legal moves.
5. Dev-only persistence is labelled in code (`DEVELOPMENT-ONLY`) and docs.
6. The Supabase adapter can implement the existing interface unchanged
   (domain-types-in/out; identity/timestamps/authz live in the service).
7. Palette actions are workspace + permission scoped via `/api/operations`
   (`service.list` → `canViewOperations`); open/create re-authorize server-side.
8. Loading / empty / error / success / permission-denied / not-signed-in states
   are represented honestly.

**Cleanups applied:** (initial commit) removed unused permission aliases and
`OperationsService.nextStatuses`, dropped a redundant console log in the error
boundary. (pre-merge) added cross-workspace write-isolation tests (60 tests total).

**Known limitations (see `DECISIONS.md` / `TECH_DEBT.md`):**

- **Persistence deferral — APPROVED.** Operations run on the in-memory dev
  repository until the planned Supabase persistence sprint (D-302, TD-05). The
  repository/service interfaces are the stable contract for that adapter.
- **In-memory store is single-worker.** A write on one worker isn't visible to a
  read on another (`next start` / serverless run multiple workers). Fine for
  single-process `next dev`; the Supabase adapter is the multi-worker/production path.
- **Lifecycle from spec, verbatim.** Six states, six transitions — no cancel path,
  because the state-machine spec lists none. Archived operations are read-only.
- Unknown operation ids render the not-found UI but return HTTP 200 (nested
  `notFound()` under the streaming `force-dynamic` console layout) — TD-10.

## Sprint 4 Review & Known Limitations

Reviewed every Sprint 4 change for architecture, security, accessibility, and
code quality. **Verified:** no UI imports the repository or OpenAI (model calls
are server-only, behind `AIProvider`); no client-controlled model/system-prompt/
tools; operator content never enters the system role; structured output is
Zod-validated; AI content rendered as text only; errors carry no secrets/prompts/
stack traces; cross-workspace reads and writes blocked; execution gated on
active-status + authz with a duplicate-run guard; no secret/prompt logging; 3
justified client components. **Fixes applied during review:** removed an unused
import; corrected a test type (`FakeMode`); updated a Sprint-1 command test for
the retired `agent.dispatch`.

**Known limitations (see `DECISIONS.md` / `TECH_DEBT.md`):**

- **Persistence deferral (approved, D-302).** Agents/executions run on the dev
  in-memory store (TD-14); the Supabase adapter implements the existing interface
  later. Single-worker only under `next start` (TD-09) — stateful run workflows
  are validated deterministically in one process.
- **No fabricated AI output.** With OpenAI unconfigured, execution returns an
  honest `unavailable` state; live model calls are untested here (no key). The
  deterministic `FakeAIProvider` is test/dev-only.
- **No global AI rate limiting** yet (only a per-agent duplicate-run guard) — TD-15.
- **Synchronous execution only**; `cancelled` is reserved for a future async
  workflow (TD-16). No autonomous background runs (D-404).
- Unknown agent id renders the not-found UI but returns HTTP 200 (same nested
  `notFound()` behavior as operations — TD-10).

## Sprint 4.5 Review & Known Limitations

Reviewed every changed file for security, duplication, dead code, and unnecessary
abstraction. **Verified:** UI never imports a provider/repository; model selection
is server-side only (no client model/system-prompt injection); operator content
never enters the system role; structured output is Zod-validated; all failures
map to safe `ExecutionError`s (no secrets/prompts/stack traces); execution logs
are secret-free; tool input is validated and tools receive ids only; OpenAI
adapter is `server-only`. **Cleanups applied:** removed a dead export
(`neverCancelled`); moved the agent result schema out of `lib/ai` into
`lib/agents`; replaced an unused eslint-disable. **Behavior preserved:** all
Sprint-4 agent tests pass unchanged; existing routes render identically.

**Known limitations (see `DECISIONS.md` / `TECH_DEBT.md`):**

- **Interface-only** (by directive, D-455): streaming, background execution
  (queue/worker/scheduler/job store), and MCP — contracts only, no
  implementation (TD-19). Tool-calling is not yet wired into the runtime loop
  (`toolCalls` always 0, TD-20).
- **Synchronous execution only.** The runtime models `cancelled`/`timed_out` and
  cancellation interfaces exist, but async/scheduled/background runs and
  mid-stream cancellation are future work (TD-16).
- **Dev-only stores.** `InMemoryExecutionLogger` (TD-18) joins the other
  in-memory stores; single-worker under `next start` (TD-09). Live model calls
  remain untested here (no key) — the honest unavailable path is covered.
- Carried: no global AI rate limiting (TD-15); persistence deferral (D-302).

## Sprint 5 Review & Known Limitations

Reviewed every Sprint 5 change for architecture, security, and code quality.
**Verified:** no UI component or repository publishes directly (feature services
publish → bus → append-only store); emitters depend only on the narrow
`SignalPublisher` seam (nothing depends on downstream consumers); emission is
best-effort and never alters a use case's result (existing Operations/Agents/
runtime tests pass unchanged); every `SignalsService` query is forcibly scoped to
`ctx.workspace.id` (cross-workspace read/get/correlate/resolve blocked, tested);
subscriptions can't cross workspaces; payloads are sanitized (secret/prompt keys
redacted — `totalTokens`/`promptVersion` preserved); auth-failure signals are
`system`-scoped and PII-free; correlation is minted once and preserved across the
chain; metrics/health are computed from signals with honest estimates and an
honest provider `unavailable` state; the notification framework is interface-only.

**Known limitations (see `DECISIONS.md` / `TECH_DEBT.md`):**

- **Dev-only stores (TD-21).** The `SignalEventStore` + `SignalBus` are in-memory
  and in-process (per-worker, TD-09). The durable store + distributed transport
  implement the existing interfaces.
- **Notifications interface-only (TD-22, D-506).** No delivery, no channels.
- **Per-feature timelines not yet unified (TD-23, D-501).** Operations/agents
  detail pages keep their existing activity timelines; only the Signals surfaces
  use the signal-derived engine, to preserve merged behavior exactly.
- **Palette/list read in memory (TD-24).** Server-side search/pagination lands
  with the durable store.
- Carried: persistence deferral (D-302), no global AI rate limiting (TD-15).

## Next Sprint

**Sprint 6 — Workflows & Automation** (planned, not started)

> Sprint 5 is merged to `main` and tagged `v0.5.0`. A detailed Sprint 6
> architecture + implementation plan (workflow domain/execution model, triggers,
> conditions, branching, variables, approvals, scheduling, retries, manual
> intervention, cancellation, resumability, audit, and Signal/AI/Operations/Agent
> integration) is prepared; **no Sprint 6 code has been written.**
