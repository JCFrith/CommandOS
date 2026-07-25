# 0003. A command surface as the primary interaction model

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Engineering

## Context

CommandOS is explicitly "not a CRUD app" and should feel like an AI operating
system. Traditional navigation-first dashboards bury actions in menus. We want an
operator to express intent directly — by command and, over time, by natural
language — from anywhere in the product.

## Decision

Make a **command surface** (⌘K palette) the primary interaction model, backed by
a typed registry and, in later sprints, OpenAI-driven natural-language parsing.

- **Global palette.** `CommandMenu` is mounted once at the root
  (`app/layout.tsx`) so ⌘K / Ctrl-K works on every surface. The shortcut lives in
  `hooks/use-command-shortcut.ts`; open/query state lives in the Zustand store
  `store/command-palette.ts`.
- **Typed, route-safe registry.** `lib/commands/registry.ts` is the single source
  of truth for operator commands, grouped (Navigate / Create / Agents / System).
  Navigation commands carry a typed `href`; action commands dispatch by id.
- **Server-only intelligence.** The OpenAI client (`lib/openai/client.ts`) is
  server-only. Sprint 4 adds natural-language → command parsing behind an agent
  runtime; the palette is the UI seam for it.
- **Honest scaffolding.** Commands whose features are not yet built navigate to
  their section carrying an `intent` query param rather than faking behavior.

## Consequences

**Positive**

- One consistent, keyboard-first way to drive the whole system.
- Adding a capability is declarative — extend the registry, not the chrome.
- A clean seam to layer AI/NL command parsing without redesigning the UI.

**Negative / Trade-offs**

- The registry must stay curated and well-grouped as commands grow.
- Discoverability for non-power users needs support (visible ⌘K affordances,
  section pages) so the palette is not the only path.

## Alternatives considered

- **Navigation-first dashboard** — familiar but contradicts the product vision
  and scatters actions; rejected.
- **Chat-only interface** — flexible but slow for routine operations and hard to
  make deterministic; rejected as the _primary_ model (chat/NL augments the
  palette instead).

## References

- `docs/design-language.md`
- `components/os/command-menu.tsx`, `lib/commands/registry.ts`
- Related: [0001](./0001-nextjs-app-router.md), [0004](./0004-feature-flags.md)
