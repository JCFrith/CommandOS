# Changelog

All notable changes to CommandOS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Narrative, per-sprint notes live in [`RELEASE_NOTES.md`](./RELEASE_NOTES.md);
this file is the terse, versioned log.

## [Unreleased]

_Nothing yet — Sprint 3 (Operations) has not started._

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

[Unreleased]: https://github.com/jcfrith/CommandOS/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jcfrith/CommandOS/releases/tag/v0.2.0
