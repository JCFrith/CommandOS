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

## How to use this log

- Add a dated, numbered entry (`D-2xx`) when a non-obvious choice is made.
- Promote a decision to a full ADR under `docs/adr/` when it becomes foundational
  or needs the Context/Consequences/Alternatives treatment.
- Decisions are append-only; supersede rather than rewrite.
