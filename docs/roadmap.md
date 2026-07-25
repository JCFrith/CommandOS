# Roadmap

Living sprint plan. Each sprint ends green on typecheck + lint + build + test.

## Sprint 0 — Foundation ✅

- [x] Next.js 15 + React 19 + TypeScript (strict) scaffold
- [x] Tailwind v4 + shadcn tokens + design language (`app/globals.css`)
- [x] Tooling: ESLint (flat), Prettier, Husky, lint-staged
- [x] Testing: Vitest + Testing Library, Playwright
- [x] Infra adapters: Supabase (client/server/middleware), OpenAI, env validation
- [x] State: TanStack Query provider, Zustand store
- [x] Folder structure per directive; source-of-truth docs
- [x] Motion-driven landing surface (`components/os/command-surface.tsx`)

**Acceptance:** `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Sprint 1 — Command Surface & Shell ✅

- [x] App shell layout: sidebar rail + top command bar + content region (`components/os/app-shell.tsx`)
- [x] ⌘K command palette (open/close, search, keyboard nav) wired to `store/command-palette`
- [x] Command registry + typed `Command` model (route-safe `href`), grouped results
- [x] Route scaffolding: `/` (surface), `/console` (shell), `agents`/`signals`/`operations`/`settings` as real routes
- [x] Reduced-motion-correct transitions; animated active-nav indicator (`layoutId`)
- [x] Landing CTAs wired (Enter → `/console`, ⌘K opens palette)

**Acceptance:** ⌘K opens/closes and filters commands from anywhere; shell renders; checks green.

## Sprint 2 — Auth & Workspaces ✅

- [x] Supabase email/password + OAuth (Google, GitHub) auth; sign-in/up/out flows
- [x] PKCE/OAuth callback route (`app/auth/callback`) with open-redirect guard
- [x] Protected routes via middleware (config-gated) + RSC-level guard; session in RSC
- [x] Workspace model + repository interface with a real personal-workspace impl
- [x] Workspace context provider + switcher; operator menu with sign-out
- [x] Account/workspace settings surface; auth validation via RHF + Zod

**Acceptance:** unauthenticated `/console` redirects to `/login` when configured;
sign-in/up/out and OAuth wired; workspace resolves per user; checks green.

## Sprint 3 — Operations

- [ ] `Operation` schema (Supabase migration) + `OperationsRepository` impl
- [ ] Server Actions (create/list) with Zod validation
- [ ] Live operations feed with optimistic updates

## Sprint 4 — Agents & AI

- [ ] Agent runtime abstraction; OpenAI-backed NL → command parsing
- [ ] Streaming agent responses; tool-call scaffolding

## Sprint 5 — Signals & Observability

- [ ] Telemetry/signals surface; Supabase realtime subscriptions

## Sprint 6 — Hardening & Deploy

- [ ] Playwright coverage of core flows; performance pass; Vercel production deploy
