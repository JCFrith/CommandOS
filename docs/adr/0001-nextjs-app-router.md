# 0001. Next.js App Router as the application framework

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Engineering

## Context

CommandOS is an AI-native operations platform that must feel like a living
operating environment — server-rendered for speed and SEO, yet richly
interactive and motion-driven. We need a framework that supports server-first
rendering, streaming, colocated data fetching, and first-class deployment on
Vercel, while keeping the client bundle small.

The build directive fixes the stack: Next.js 15, React 19, TypeScript, Server
Actions, and "Edge Runtime where appropriate."

## Decision

Use **Next.js 15 (App Router)** with **React 19** as the application framework.

- **Server Components by default.** Client Components (`'use client'`) are opt-in
  and pushed to the leaves for interactivity and motion.
- **Server Actions** for mutations, validated with Zod at the boundary.
- **`typedRoutes`** enabled for compile-time route safety; the command registry
  consumes the generated `Route` type.
- **Middleware** (`middleware.ts`) refreshes auth sessions on navigational
  requests.
- **Runtime:** default to the Node.js runtime (Vercel Fluid Compute) rather than
  forcing Edge; adopt Edge per-route only where a concrete latency win exists.

## Consequences

**Positive**

- Small client bundles; most of the tree renders on the server.
- Route-safe navigation across the app and the command palette.
- Natural fit for Vercel deployment and streaming.

**Negative / Trade-offs**

- The server/client boundary requires discipline (secrets and heavy deps stay
  server-only; see `lib/env.ts`, `lib/openai/client.ts`).
- App Router + React 19 are relatively new; some libraries need version care.

## Alternatives considered

- **Next.js Pages Router** — mature but no RSC/Server Actions; rejected.
- **Vite + React SPA** — great DX but loses SSR/streaming and server-first data;
  rejected for a platform that must render fast and integrate secrets server-side.

## References

- `docs/architecture.md`
- `MASTER_BUILD.md`
- Related: [0002](./0002-supabase.md), [0003](./0003-ai-command-surface.md)
