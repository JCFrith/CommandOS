# PROJECT_STATUS

_Last updated after Sprint 2._

## Current Sprint

**Sprint 2 — Auth & Workspaces** ✅ complete (branch `sprint-2-auth-workspaces`).
Sprint 1 — Command Surface & Shell ✅ (`fed69e6`) · Sprint 0 — Foundation ✅ (`f4809c0`).

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

## Build Status

| Gate                | Result                              |
| ------------------- | ----------------------------------- |
| `npm run lint`      | ✅ No ESLint warnings or errors     |
| `npm run typecheck` | ✅ `tsc --noEmit` clean             |
| `npm run build`     | ✅ 11 pages generated, 8 app routes |

Runtime smoke (unconfigured, prod server): `/`, `/login`, `/console`,
`/console/settings` → 200; `/auth/callback` → 307 → `/login?error=auth`.

## Test Status

| Suite            | Result                                                     |
| ---------------- | ---------------------------------------------------------- |
| Unit (Vitest)    | ✅ 16 passing across 5 files                               |
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

## Next Sprint

**Sprint 3 — Operations** (not started; awaiting approval)

- `Operation` schema (Supabase migration) + `OperationsRepository` implementation
- Server Actions (create/list) with Zod validation
- Live operations feed with optimistic updates

> Sprint 3 has **not** been started. Awaiting approval.
