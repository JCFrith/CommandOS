# Architecture Decision Records

This directory records the significant architectural decisions for CommandOS,
using the [Nygard ADR format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Each record is immutable once **Accepted**: to change a decision, add a new ADR
that supersedes the old one rather than editing history.

On any conflict, `MASTER_BUILD.md` remains authoritative (see `../../CLAUDE.md`).

## Index

| ADR                                  | Title                                                           | Status   |
| ------------------------------------ | --------------------------------------------------------------- | -------- |
| [0001](./0001-nextjs-app-router.md)  | Next.js App Router as the application framework                 | Accepted |
| [0002](./0002-supabase.md)           | Supabase for auth and persistence, behind repository interfaces | Accepted |
| [0003](./0003-ai-command-surface.md) | A command surface as the primary interaction model              | Accepted |
| [0004](./0004-feature-flags.md)      | Feature flags for progressive delivery                          | Proposed |

## Statuses

- **Proposed** — under discussion; documented ahead of implementation.
- **Accepted** — decided and in effect.
- **Superseded** — replaced by a later ADR (link it).
- **Deprecated** — no longer applies; not yet replaced.

## Adding an ADR

1. Copy the structure of an existing record.
2. Use the next zero-padded number: `NNNN-short-kebab-title.md`.
3. Start at **Proposed** (or **Accepted** if already decided and shipped).
4. Fill in Context, Decision, Consequences, and Alternatives considered.
5. Add a row to the index above and cross-link related ADRs.
