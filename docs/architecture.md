# Architecture

## Principles

- **Server-first.** React Server Components are the default. Client Components
  are opt-in (`'use client'`) and kept at the leaves for interactivity/motion.
- **Command-driven.** The ⌘K palette and natural-language input are the primary
  entry points; traditional navigation is secondary.
- **Layered.** UI → services (domain) → repositories (persistence). Feature code
  never imports Supabase or OpenAI directly.

## Layers

```
┌─────────────────────────────────────────────┐
│ app/  + components/os     (surfaces, motion) │  presentation
├─────────────────────────────────────────────┤
│ hooks/  store/  lib/query (client glue)      │  interaction/state
├─────────────────────────────────────────────┤
│ services/                 (domain logic)     │  domain
├─────────────────────────────────────────────┤
│ services/**/repository    (interfaces)       │  persistence boundary
├─────────────────────────────────────────────┤
│ lib/supabase  lib/openai  (adapters)         │  infrastructure
└─────────────────────────────────────────────┘
```

## Key modules

| Module                                       | Responsibility                                  |
| -------------------------------------------- | ----------------------------------------------- |
| `lib/env.ts`                                 | Zod-validated, lazily-memoized env access.      |
| `lib/supabase/{client,server,middleware}.ts` | SSR-correct Supabase clients + session refresh. |
| `lib/openai/client.ts`                       | Server-only OpenAI client + default model.      |
| `lib/query/provider.tsx`                     | TanStack Query provider (server-state cache).   |
| `store/*`                                    | Zustand stores for ephemeral UI state.          |
| `services/**`                                | Domain services + repository interfaces.        |
| `middleware.ts`                              | Auth session refresh on navigational requests.  |

## Data flow (mutation)

1. Client surface dispatches intent (form / command).
2. A **Server Action** validates input with Zod.
3. The action calls a **service**, which uses a **repository** interface.
4. The repository's Supabase implementation persists the change.
5. TanStack Query cache is invalidated; the surface re-renders.

## Environment

Secrets are validated once via `serverEnv()`; public config via `clientEnv()`.
Neither reads `process.env` at import time, so builds without secrets do not
crash. See `.env.example` for the full contract.
