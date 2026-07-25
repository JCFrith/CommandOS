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

## How to use this log

- Add a dated, numbered entry (`D-2xx`) when a non-obvious choice is made.
- Promote a decision to a full ADR under `docs/adr/` when it becomes foundational
  or needs the Context/Consequences/Alternatives treatment.
- Decisions are append-only; supersede rather than rewrite.
