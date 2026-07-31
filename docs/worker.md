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
