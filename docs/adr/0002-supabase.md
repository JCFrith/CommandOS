# 0002. Supabase for auth and persistence, behind repository interfaces

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Engineering

## Context

CommandOS needs authentication, a relational store, row-level security, and
real-time subscriptions (for the future Signals surface). The build directive
lists Supabase and mentions Prisma only conditionally ("if specified in docs").
We also want feature code to remain decoupled from the database so the backing
store can evolve without rewriting call sites.

## Decision

Use **Supabase** as the backend for auth, persistence, and realtime, accessed
through **repository interfaces** rather than directly.

- **SSR-correct clients** via `@supabase/ssr`:
  - `lib/supabase/client.ts` — browser client for Client Components.
  - `lib/supabase/server.ts` — request-scoped server client (cookie-bound).
  - `lib/supabase/middleware.ts` — session refresh in middleware.
- **No Prisma.** Supabase's client is the data access layer; there is no second
  ORM. This resolves the directive's conditional in the negative.
- **Repository boundary.** Feature code depends on interfaces in `services/`
  (e.g. `OperationsRepository`), not on Supabase APIs. Implementations are
  swapped, not call sites.
- **Environment** is validated once through `lib/env.ts`; the service-role key is
  server-only and never referenced from client code.

## Consequences

**Positive**

- Auth, DB, RLS, and realtime from one managed provider.
- Domain logic is testable against interfaces and portable if the store changes.
- Clear server/client secret separation.

**Negative / Trade-offs**

- Repository indirection adds a small amount of boilerplate before a feature can
  persist data.
- Supabase RLS policies become a critical, security-sensitive surface to review.

## Alternatives considered

- **Prisma + hosted Postgres** — strong typing and migrations, but a second data
  layer, no built-in auth/realtime, and heavier server deps; rejected.
- **Direct Supabase calls in feature code** — less boilerplate but couples the UI
  to the database and defeats swappability; rejected.

## References

- `docs/architecture.md` (layering, data-flow)
- `services/operations/operations-repository.ts`
- Related: [0001](./0001-nextjs-app-router.md)
