# PROJECT_STATUS

_Last updated after the post-Sprint-1 technical-debt audit._

## Current Sprint

**Sprint 1 — Command Surface & Shell** ✅ complete (committed `fed69e6`).
Sprint 0 — Foundation ✅ complete (committed `f4809c0`).

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

## Build Status

| Gate                | Result                             |
| ------------------- | ---------------------------------- |
| `npm run lint`      | ✅ No ESLint warnings or errors    |
| `npm run typecheck` | ✅ `tsc --noEmit` clean            |
| `npm run build`     | ✅ 9 pages generated, 6 app routes |

## Test Status

| Suite            | Result                                                     |
| ---------------- | ---------------------------------------------------------- |
| Unit (Vitest)    | ✅ 8 passing across 3 files                                |
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
| Unused dependencies    | `react-hook-form` + `@hookform/resolvers` not yet imported.          | Retained — mandated stack; first used in Sprint 2/3 forms.        |
| Premature abstractions | `OperationsRepository` + `Operation` types have no implementer yet.  | Retained — documented persistence boundary; implemented Sprint 3. |
| Simplification         | No further safe simplifications without changing behavior.           | ✅ Deferred to feature sprints.                                   |

## Outstanding Issues

- `next lint` prints a deprecation notice (removed in Next.js 16). Non-blocking; migrate to the ESLint CLI (`@next/codemod next-lint-to-eslint-cli`) in a future chore.
- `npm audit` reports transitive advisories from dev/build deps; no known impact on the app. Review before production.
- Native install scripts (esbuild, sharp) run under npm allow-scripts warnings in this environment; builds/tests succeed regardless.
- Action commands (`New Operation`, `Dispatch an Agent`) currently navigate to their section carrying an `intent` query param; the actual create/dispatch flows land in Sprints 3 and 4.
- Playwright e2e not executed this cycle (requires a build+serve run).
- `react-hook-form` + `@hookform/resolvers` are installed but unused until form work (Sprint 2/3); retained per the mandated stack.
- `OperationsRepository` interface + `Operation` types are declared with no implementer yet; the Supabase implementation lands in Sprint 3.

## Next Sprint

**Sprint 2 — Auth & Workspaces** (not started; awaiting approval)

- Supabase email/OAuth authentication, sign-in/out flows
- Protected routes via middleware; session available in RSC
- Workspace context + switcher

> Per directive: Sprint 2 has **not** been started. Awaiting approval.
