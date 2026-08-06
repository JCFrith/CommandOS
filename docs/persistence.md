# Persistence

Sprint 6.5 — Production Foundation. Every domain has always depended on a
**repository/store interface**, not a concrete store, so production persistence
is an **adapter + binding swap** with **no service or UI change** and **no
behavior change**. This doc is the map of interfaces → implementations and how
the binding is selected.

## The gate

Production Postgres persistence is enabled **only** when all three hold
(`lib/env.ts → isSupabasePersistenceEnabled()`):

1. Supabase is configured (`NEXT_PUBLIC_SUPABASE_URL` / anon key), and
2. `SUPABASE_SERVICE_ROLE_KEY` is present, and
3. `USE_SUPABASE_PERSISTENCE=1` (explicit opt-in).

Otherwise every store falls back to the **development in-memory** implementation.
So `next dev`, the test suite, and any unconfigured environment behave exactly as
before — Sprint 6.5 changed infrastructure, not features.

The server-only Supabase adapters are **lazy-required** inside the binding
factory, so they never enter the dev/client bundle.

## Interfaces → implementations

| Interface (contract)                              | Dev (in-memory)                 | Production (Postgres)            |
| ------------------------------------------------- | ------------------------------- | -------------------------------- |
| `OperationsRepository`                            | `InMemoryOperationsRepository`  | `SupabaseOperationsRepository` † |
| `AgentRepository`                                 | `InMemoryAgentRepository`       | `SupabaseAgentRepository` †      |
| `ExecutionLogger`                                 | `InMemoryExecutionLogger`       | `SupabaseExecutionLogger` †      |
| `SignalEventStore`                                | `InMemorySignalEventStore`      | **`SupabaseSignalEventStore`**   |
| signal subscriptions                              | in-memory                       | `signal_subscriptions` table †   |
| `WorkflowRepository` + `WorkflowRunSink`          | `InMemoryWorkflowRepository`    | `SupabaseWorkflowRepository` †   |
| `LeasedJobStore` + `ExecutionQueue` + `Scheduler` | `InMemoryLeasedJobStore`        | **`SupabaseLeasedJobStore`**     |
| `BackgroundWorker`                                | `LeasedBackgroundWorker` (tick) | same (driven by Vercel Cron)     |

**Implemented + wired this sprint:** the durable-execution path
(`SupabaseLeasedJobStore` + worker + `/api/worker`) and the append-only
`SupabaseSignalEventStore`, both behind the gate. † The remaining domain
repositories are **pure row-mapping** on the same pattern (the `Supabase*` classes
map snake_case rows ↔ domain types and scope every query by `workspace_id`);
they are the tracked remaining adapter work (TD-30/34) — the schema, gate, worker,
and two worked adapters are the template, and none require a service/UI change.

## Append-only & immutability

`signals`, `signal_events`, `workflow_step_runs`, `execution_logs`,
`trigger_claims`, and `schedule_occurrences` are **append-only** — the database
rejects `UPDATE`/`DELETE` via triggers. `workflow_versions` are **immutable**
(reject `UPDATE`). A signal's lifecycle is folded from its events at read time
(`projectLifecycle`), never by mutating the row — identical to the in-memory
semantics. See [database.md](./database.md).

## Failure recovery

The in-memory path is per-realm (TD-09). The Postgres path is durable and
multi-worker: runs/jobs/timers survive restarts, and the leasing model (see
[worker.md](./worker.md)) recovers work abandoned by a crashed worker. Resume is
idempotent (workflow steps skip by node id), so at-least-once execution is safe.

The Postgres path is **implementation-complete but not production-verified** until
it passes the fail-closed validation gate against a real database (D-656); the
same contract suites run against both the in-memory and Supabase adapters. See
[production-validation.md](./production-validation.md).

## Staging & deployment

Running the durable path on a real hosted deployment (isolated Supabase staging + Vercel, `USE_SUPABASE_PERSISTENCE=1`) — including how to verify the active adapters are Supabase-backed and not in-memory — is documented in [staging.md](./staging.md) and [deployment.md](./deployment.md).

## Personal-workspace provisioning (durable path)

Domain tables (`operations`, `agents`, `workflows`, …) key `workspace_id` as `uuid`
with a foreign key to `workspaces(id)`, so a real authenticated user needs a
**persisted** workspace before they can create anything with persistence enabled.

- **Identity:** a real `gen_random_uuid()` workspace row (never the dev
  `personal-<id>` string), resolved by **membership**.
- **One personal workspace per user:** a partial unique index
  `workspaces(owner_id) where kind = 'personal'` enforces it and makes concurrent
  first-request provisioning race-safe (a losing inserter resolves the winner).
- **Provisioning:** the `security definer` RPC
  `app_provision_personal_workspace(p_user_id, p_name)` atomically resolves-or-creates
  the workspace + an `owner` `workspace_members` row. It is **server-only** —
  `execute` is revoked from `public`/`anon`/`authenticated` and granted only to
  `service_role`, and it is called with a **trusted** user id from the server
  session, so it can never be client-driven or provision for another user.
- **Gating:** `workspaceRepository` is `SupabaseWorkspaceRepository` when persistence
  is enabled, else the unchanged in-memory `PersonalWorkspaceRepository`.
- **Team-ready:** resolution is by membership; `kind='team'` workspaces (many
  members, `owner_id` null) are unaffected — no assumption that every workspace is
  personal. See [D-664](../DECISIONS.md).
