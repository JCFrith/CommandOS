# CLAUDE.md — Engineering Conventions

Guidance for AI and human contributors working in CommandOS.

## Golden rules

1. **`MASTER_BUILD.md` is authoritative.** On any documentation conflict, it wins.
2. **Never leave broken code.** Every milestone must pass typecheck, lint, and build.
3. **No placeholders, no fake implementations, no `TODO` stubs.** If a dependency is
   missing, build the proper abstraction (interface + concrete impl) instead.
4. **Never invent architecture.** Follow `/docs`. Extend deliberately.

## Definition of done (run before every commit)

```bash
npm run typecheck
npm run lint
npm run build
npm run test
```

## Conventions

- **Imports:** use the `@/*` path alias (e.g. `@/lib/utils`), not relative `../../`.
- **Server vs client:** Client Components must start with `'use client'`. Anything
  touching secrets (`serverEnv`, OpenAI, Supabase service role) is server-only.
- **Env:** never read `process.env` directly in feature code — go through
  `lib/env.ts` (`serverEnv()` / `clientEnv()`), which validates with Zod.
- **State:** server state → TanStack Query; ephemeral UI state → Zustand (`store/`).
  Do not duplicate server data into Zustand.
- **Data access:** feature code depends on repository interfaces in `services/`,
  not on Supabase directly. Swap implementations, not call sites.
- **UI:** shadcn primitives live in `components/ui`. Product surfaces live in
  `components/os`. Use `cn()` for class composition. Respect `useReducedMotion`.
- **Styling:** Tailwind v4 utilities only; design tokens are in `app/globals.css`.
- **Types:** `strict` + `noUncheckedIndexedAccess`. No `any`; prefer `unknown` + narrowing.

## Commits

Small, logical, conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
