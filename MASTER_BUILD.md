# MASTER_BUILD.md

**Authoritative build directive for CommandOS. On any conflict with other
documentation, this file overrides everything.**

## Vision

CommandOS is an enterprise-grade, AI-native operations platform. It is an
_operating system for running an operation_ — not a CRUD app and not a generic
dashboard. The experience must feel like an intelligent, living environment:
modern, fluid, motion-driven, and context-aware.

Three primitives compose the product:

- **Agents** — autonomous operators that plan, act, and report across systems.
- **Signals** — unified, real-time operational telemetry and context.
- **Operations** — every unit of work (human- or agent-initiated) tracked from
  intent to outcome.

The primary interaction model is **command-driven** (⌘K palette + natural
language), not navigation-driven.

## Non-negotiable engineering standards

- Production-ready at every milestone (typecheck + lint + build + tests green).
- No placeholders, no fake implementations, no TODO stubs.
- Missing dependency ⇒ build the proper abstraction, never a stub.
- Strict TypeScript. Validated environment. Server/client boundaries respected.
- Small, logical, conventional commits.

## Architecture summary

See [`docs/architecture.md`](./docs/architecture.md). In short: Next.js App
Router with Server Components by default, Server Actions for mutations, Supabase
for auth + persistence (accessed only through `services/` repositories), OpenAI
for intelligence (server-only), TanStack Query for server state, Zustand for
ephemeral UI state.

## Roadmap

The canonical, living sprint plan is [`docs/roadmap.md`](./docs/roadmap.md).

| Sprint | Theme                   | Outcome                                               |
| ------ | ----------------------- | ----------------------------------------------------- |
| **0**  | Foundation              | Tooling, structure, design system, CI-green skeleton. |
| **1**  | Command Surface & Shell | App shell, command palette (⌘K), navigation model.    |
| **2**  | Auth & Workspaces       | Supabase auth, protected routes, workspace context.   |
| **3**  | Operations              | Operations model, repository, live feed.              |
| **4**  | Agents & AI             | Agent runtime, OpenAI-backed command parsing.         |
| **5**  | Signals & Observability | Telemetry surface, real-time updates.                 |
| **6**  | Hardening & Deploy      | E2E coverage, performance, Vercel production.         |

Definition of done for a sprint: all acceptance criteria in `docs/roadmap.md`
met, and the four checks (typecheck/lint/build/test) pass.
