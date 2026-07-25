# 0004. Feature flags for progressive delivery

- **Status:** Proposed
- **Date:** 2026-07-24
- **Deciders:** Engineering

> **Note:** This decision is **Proposed**, not yet implemented. It is documented
> ahead of the code so the sprint that introduces flags has a clear contract. It
> does not describe existing behavior.

## Context

CommandOS ships sprint by sprint, and several surfaces (Operations, Agents,
Signals) land incrementally. We need to:

- merge partial work to `main` without exposing it to all users,
- gate expensive or sensitive capabilities (AI dispatch) per workspace/role,
- run staged rollouts and kill-switch a misbehaving feature quickly,

without scattering `if` checks or coupling feature code to a specific provider.

## Decision (proposed)

Introduce a **feature-flag abstraction** evaluated server-side, mirroring the
repository pattern used elsewhere.

- **`FeatureFlagProvider` interface** in `services/flags/` with an
  `isEnabled(flag, context)` contract, where `context` carries user/workspace.
- **Two implementations:**
  - **Static/env-driven** (default): flags resolved from validated env in
    `lib/env.ts` (e.g. `NEXT_PUBLIC_FLAG_*` for client-safe, unprefixed for
    server-only). Zero infra, ideal for build-time and local toggles.
  - **Supabase-backed** (later): a `feature_flags` table + per-workspace
    overrides, enabling runtime rollout and kill-switches (see
    [0002](./0002-supabase.md)).
- **Typed flag catalog.** A single `FLAGS` registry (like the command registry in
  [0003](./0003-ai-command-surface.md)) declares every flag, its default, and
  description — no stringly-typed lookups.
- **Evaluation site.** Prefer server evaluation in RSC/Server Actions; expose
  only the resolved boolean to the client. A small `useFlag` hook reads
  server-provided values for Client Components.
- **Command integration.** The palette hides or disables commands whose flag is
  off, so gating is declarative.

## Consequences

**Positive**

- Trunk-based development: unfinished surfaces merge behind a flag.
- Per-workspace/role gating and instant kill-switch (with the Supabase impl).
- Provider-swappable; call sites depend on the interface, not the source.

**Negative / Trade-offs**

- Flag debt: every flag needs an owner and a removal date, or the catalog rots.
- Two evaluation contexts (build-time env vs. runtime DB) must be kept coherent.
- Testing multiplies with each live flag combination.

## Alternatives considered

- **Third-party SaaS (LaunchDarkly, etc.)** — powerful but adds a vendor, cost,
  and a network dependency in the request path; revisit only if scale demands.
- **Ad-hoc env booleans scattered in code** — trivial but untyped, unauditable,
  and impossible to override per workspace; rejected.
- **No flags; ship only complete features** — simplest, but blocks trunk-based
  delivery and staged rollout; rejected.

## Open questions

- Which flags are needed first (AI dispatch, Signals realtime)?
- Where does the env→DB cutover happen, and how are overrides audited?
- Client exposure policy for `NEXT_PUBLIC_FLAG_*` values.

## References

- `lib/env.ts`, `services/` (repository pattern)
- Related: [0002](./0002-supabase.md), [0003](./0003-ai-command-surface.md)
