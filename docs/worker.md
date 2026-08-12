# Background Worker

The production background worker (`services/jobs/worker.ts`,
`app/api/worker/route.ts`) — **stateless**, driven by Vercel Cron. It is the
durable-execution engine for scheduled/async work; no long-running process, no
persistent-connection assumptions.

## Flow

```
Vercel Cron (* * * * *) → POST /api/worker → BackgroundWorker.tick()
       → LeasedJobStore.reclaimExpired + claim_jobs (SKIP LOCKED)
       → JobHandler.handle(job) → WorkflowRuntime → Platform Runtime → Signals
       → complete | retry
```

Each `tick()` claims a bounded batch, runs each job through its registered
`JobHandler`, and completes or retries it — then emits a `worker.heartbeat`
Signal with queue stats. The endpoint is guarded by a shared `CRON_SECRET`
(bearer token) when configured.

## Lease model

A job carries `lease_until` + `lease_worker`. Claiming (`claim_jobs`) sets a
time-boxed lease and increments `attempts`. While a long job runs the worker may
`renewLease`. On success → `complete` (idempotent). On failure → `fail`, which
**re-queues with backoff** while `attempts < max_attempts`, else marks `failed`.

**Crash / stale recovery:** if a worker dies mid-job, its lease expires; the next
tick's `reclaimExpired` (and `claim_jobs`, which also selects expired-lease
`running` rows) returns the job to the pool and it is re-run. Because handlers are
**idempotent** (the WorkflowRuntime skips completed steps by node id), this
at-least-once re-execution is safe. Duplicate delivery of the same trigger
occurrence is separately prevented by `trigger_claims` (idempotency).

## Queue model

`LeasedJobStore` (`ExecutionQueue` + `JobStore` + `Scheduler` + leasing):
`enqueue`/`schedule` (delayed via `scheduled_for`), `claimDue`, `renewLease`,
`complete`, `fail`, `reclaimExpired`, `stats`. The in-memory implementation
(`InMemoryLeasedJobStore`) mirrors the Postgres semantics exactly, so the leasing
logic is unit-tested deterministically (time is passed as `nowIso`), and the
Supabase implementation satisfies the **same contract**
(`tests/unit/support/job-store-contract.ts`).

## Timers & schedules

- **Delay nodes** persist a `workflow_timers(due_at)` row; the worker resumes due
  timers.
- **Scheduled workflows** claim one firing per occurrence via
  `schedule_occurrences` (dedup), then enqueue a run.

## Observability

The worker emits `worker.heartbeat` + `job.completed`/`job.failed` Signals, and
Health gains `worker`, `queue`, and `database` subsystems (heartbeat age, queue
depth, oldest queued, expired leases). See [observability.md](./observability.md).

## Development

With persistence disabled (the default), the worker exists but the in-memory
queue is per-realm and workflows run synchronously, so there is nothing to drain
— identical behavior to before. The durable path activates only when
`USE_SUPABASE_PERSISTENCE=1` (see [persistence.md](./persistence.md)).

The durable worker's leasing, crash recovery, bounded retries, and idempotency
are exercised against a real database by the integration suites in
`tests/integration/{worker,concurrency,recovery}.test.ts`, part of the Sprint 6.5
release gate — see [production-validation.md](./production-validation.md).

## Deployment & cron verification

The Vercel Cron `* * * * * → /api/worker` setup, the authorized/rejected tick checks, and heartbeat/lease-recovery verification are documented in [deployment.md](./deployment.md#worker--cron-verification) and the staging checklist in [staging.md](./staging.md#step-6--worker--cron-validation).

## Durable trigger & resume passes (Sprint 7)

In durable mode each tick runs ordered, failure-isolated pre-claim passes between
reclaim and claim: **signal triggers → schedules → timers → approval resumes**,
then claim → execute → heartbeat. They enqueue `workflow.run` / `workflow.resume`
jobs drained the same tick; a throwing pass emits `worker.pass.failed` and never
blocks the others or the job drain. Per-pass liveness + aggregate health are at
`GET /api/worker/health`. Full design: [durable-triggers.md](./durable-triggers.md).
