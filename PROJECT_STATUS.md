# PROJECT_STATUS

_Last updated at the Sprint 4 — Agents & AI release (`v0.4.0`)._

## Current Sprint

**Sprint 4 — Agents & AI** ✅ complete — reviewed, merged to `main`, tagged
`v0.4.0`.
Sprint 3 — Operations ✅ (`v0.3.0`, `31df2c7`) · Sprint 2 — Auth & Workspaces ✅
(`v0.2.0`, `cef73ef`) · Sprint 1 — Command Surface & Shell ✅ (`fed69e6`) ·
Sprint 0 — Foundation ✅ (`f4809c0`).

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

## Build Status

| Gate                | Result                                               |
| ------------------- | ---------------------------------------------------- |
| `npm run lint`      | ✅ No ESLint warnings or errors                      |
| `npm run typecheck` | ✅ `tsc --noEmit` clean                              |
| `npm run build`     | ✅ compiled; 18 app routes (5 new agents routes/api) |

Runtime smoke (unconfigured, prod server): agents list (empty state), create form
(Type + Capabilities), `/api/agents` scoped JSON, unknown id → not-found → all 200. **TD-13**: `?workspaceId=<member>` scopes; `?workspaceId=<foreign>` → empty
(no leak). Create-agent Server Action → 303 → real UUID; empty name → validation
error. The full run workflow (create → activate → run success/failed → unavailable
→ history → activity → cross-workspace → permission denial) is verified in a
single realm via an in-process walkthrough driving the real `AgentService` +
`FakeAIProvider` — cross-request read-back is not observable under the multi-worker
server (TD-09).

## Test Status

| Suite            | Result                                                     |
| ---------------- | ---------------------------------------------------------- |
| Unit (Vitest)    | ✅ 114 passing across 21 files (55 new for Agents & AI)    |
| E2E (Playwright) | Configured; `home.spec.ts` present (not run in this cycle) |

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

## Next Sprint

**Sprint 5 — Signals & Observability** (not started)

- Telemetry/signals surface; Supabase realtime subscriptions

> Sprint 4 is complete on its branch but **not merged, not tagged**. Sprint 5 has
> **not** been started.
