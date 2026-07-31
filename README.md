# CommandOS

The AI-native operations platform. CommandOS unifies **agents**, **signals**, and
**operations** into a single context-aware surface — an operating environment
for running a business at the speed of intent.

> This is not a CRUD dashboard. The interface is designed to feel like an AI
> operating system: modern, fluid, motion-driven, and context-aware.

## Stack

| Concern        | Choice                                 |
| -------------- | -------------------------------------- |
| Framework      | Next.js 15 (App Router) + React 19     |
| Language       | TypeScript (strict)                    |
| Styling        | Tailwind CSS v4 + shadcn/ui (new-york) |
| Motion         | Framer Motion                          |
| Icons          | lucide-react                           |
| Forms          | React Hook Form + Zod                  |
| Server state   | TanStack Query                         |
| Client state   | Zustand                                |
| Backend / Auth | Supabase (SSR)                         |
| AI             | OpenAI SDK                             |
| Deployment     | Vercel                                 |
| Unit tests     | Vitest + Testing Library               |
| E2E tests      | Playwright                             |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase + OpenAI credentials
npm run dev
```

Open http://localhost:3000.

## Scripts

| Script              | Purpose                    |
| ------------------- | -------------------------- |
| `npm run dev`       | Start the dev server       |
| `npm run build`     | Production build           |
| `npm run start`     | Serve the production build |
| `npm run lint`      | ESLint                     |
| `npm run typecheck` | `tsc --noEmit`             |
| `npm run format`    | Prettier write             |
| `npm run test`      | Vitest (unit)              |
| `npm run test:e2e`  | Playwright (e2e)           |

## Project layout

```
app/          App Router routes, layouts, global styles
components/    UI components (components/ui = shadcn primitives, components/os = product)
lib/          Framework glue: supabase, openai, query provider, env, utils
hooks/        Reusable client hooks
services/     Domain services & repository boundaries (DB-agnostic)
store/        Zustand client-state stores
types/        Shared domain types
tests/        unit/ (Vitest) and e2e/ (Playwright)
docs/         Source-of-truth documentation
```

## CI & deployment

- **CI** (`CommandOS CI`, `.github/workflows/ci.yml`) runs `lint · typecheck · test ·
build` on every PR and `main` push (Node 22, no secrets). See [docs/ci.md](./docs/ci.md).
- **Persistence is opt-in.** By default the app runs on in-memory dev adapters. The
  durable Postgres/Supabase path activates only when `USE_SUPABASE_PERSISTENCE=1` with
  a configured Supabase URL/anon key + `SUPABASE_SERVICE_ROLE_KEY`.
- **Environments, env vars, deploy + rollback:** [docs/deployment.md](./docs/deployment.md).
- **Staging provisioning + smoke checklist:** [docs/staging.md](./docs/staging.md).
- **Release gate (real DB):** [docs/production-validation.md](./docs/production-validation.md).

Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `OPENAI_API_KEY`)
are never `NEXT_PUBLIC_*` and never reach the browser.

## Documentation

- [`MASTER_BUILD.md`](./MASTER_BUILD.md) — the authoritative build directive & roadmap (overrides all other docs on conflict)
- [`CLAUDE.md`](./CLAUDE.md) — engineering conventions for AI/human contributors
- [`docs/`](./docs) — architecture, design language, and sprint plan
- [`docs/ci.md`](./docs/ci.md) · [`docs/deployment.md`](./docs/deployment.md) · [`docs/staging.md`](./docs/staging.md) — CI, deployment, staging
