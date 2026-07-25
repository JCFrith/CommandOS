# Release Notes

All notable changes to CommandOS, newest first. Versioning is sprint-aligned
until the first tagged release.

## Sprint 2 — Auth & Workspaces

_CommandOS gets identity: operators sign in, the console is protected, and every
operator works within a workspace._

### Added

- **Authentication.** Supabase-backed sign-in / sign-up with email + password and
  **OAuth** (Google, GitHub). Client validation via React Hook Form + Zod;
  server actions re-validate with the same schema and own the redirect.
- **OAuth callback.** `app/auth/callback` exchanges the PKCE code for a session,
  with an open-redirect guard on the `next` param.
- **Route protection.** Middleware redirects unauthenticated operators from
  `/console/*` to `/login` (and authenticated operators away from `/login`),
  with a defense-in-depth guard in the console layout. All gating is skipped when
  Supabase is not configured, so local dev still runs.
- **Session in RSC.** `getCurrentUser()` (request-memoized) projects the Supabase
  user onto a typed `AuthUser`.
- **Workspaces.** A `Workspace` model, a `WorkspaceRepository` interface, and a
  real `PersonalWorkspaceRepository` (one workspace derived per operator — no
  placeholder rows). Workspace **context provider** + **switcher** in the shell.
- **Operator menu** with avatar, identity, and **sign-out**; a real account /
  workspace **Settings** surface.
- **UI primitives.** `input`, `label`, `avatar`, `dropdown-menu` (shadcn).

### Changed

- `Settings` is now a real surface (was a roadmap placeholder).
- Supabase server client no longer depends on unrelated secrets (OpenAI,
  service role) — auth works with just the two public Supabase keys.
- Console routes are `force-dynamic` so session state is never served statically.

### Verification

`npm run lint` ✔ · `npm run typecheck` ✔ · `npm run build` ✔ (9 routes) ·
`npm test` ✔ (14 passing) · runtime smoke: `/`, `/login`, `/console`,
`/console/settings` → 200; `/auth/callback` → 307.

## Sprint 1 — Command Surface & Shell

_The console comes online: an operator can now command CommandOS from anywhere._

### Added

- **Global command palette (⌘K / Ctrl-K).** A cmdk-powered palette, mounted
  app-wide, with fuzzy search and grouped results. Open it from any surface.
- **Typed command registry.** A single, route-safe source of truth
  (`lib/commands/registry.ts`) for every operator command, grouped into
  Navigate / Create / Agents.
- **Console shell.** A navigation rail + command bar + content region
  (`components/os/app-shell.tsx`) with an animated active-nav indicator that
  respects reduced motion.
- **Console routes.** `/console` plus `agents`, `signals`, `operations`, and
  `settings` sections — each an honest scaffold naming the sprint its feature
  lands in (no fake functionality).
- **shadcn primitives.** `dialog` and `command` components added under
  `components/ui`.
- **Wired landing CTAs.** "Enter CommandOS" routes to the console; "⌘K" opens
  the palette.

### Changed

- Landing action buttons are now functional (previously static).

### Internal / Technical Debt

- Extracted the duplicated "systems nominal" indicator into a shared
  `SystemStatus` component (used by the landing surface and the console bar).
- Moved the ⌘K keydown listener into a reusable `useCommandShortcut` hook and
  removed the unused `useMounted` hook (dead code).
- Added unit tests for the command registry (8 unit tests total, all passing).

### Verification

`npm run lint` ✔ · `npm run typecheck` ✔ · `npm run build` ✔ (6 routes) ·
`npm test` ✔ (8 passing)

## Sprint 0 — Foundation

_Project bootstrap._

### Added

- Next.js 15 (App Router) + React 19 + strict TypeScript.
- Tailwind CSS v4 + shadcn/ui (new-york) with the CommandOS design language
  (OKLCH tokens, dark-first).
- Tooling: ESLint (flat config), Prettier, Husky + lint-staged.
- Testing: Vitest + Testing Library, Playwright.
- Infrastructure adapters: Supabase (SSR client/server/middleware), OpenAI
  (server-only), Zod-validated environment access.
- State management: TanStack Query (server state) and Zustand (UI state).
- Motion-driven landing surface and source-of-truth documentation.
