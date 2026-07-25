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

## Sprint 1 — Command Surface & Shell

- [ ] App shell layout: sidebar rail + top command bar + content region
- [ ] ⌘K command palette (open/close, search, keyboard nav) wired to `store/command-palette`
- [ ] Command registry + typed `Command` model, grouped results
- [ ] Route scaffolding: `/` (surface), `/console` (shell), placeholder sections as real routes
- [ ] Reduced-motion-correct transitions between surfaces

**Acceptance:** ⌘K opens/closes and filters commands; shell renders; checks green.

## Sprint 2 — Auth & Workspaces

- [ ] Supabase email/OAuth auth, sign-in/out flows
- [ ] Protected routes via middleware; session in RSC
- [ ] Workspace context + switcher

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
