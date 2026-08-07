# Durable Triggers & Resumption (Sprint 7 Phase 1)

How CommandOS evaluates workflow **signal triggers, schedules, timers, and
approvals** durably — from the persisted database via the stateless worker —
instead of an in-process registry. This is what makes automation survive
serverless cold starts, multiple instances, worker crashes, duplicate cron, and
deployment restarts.

Decisions: **D-665** (cursor), **D-666** (durable worker execution),
**D-667** (latency bounded by cadence), **D-668** (timer/approval resumption).
Supersedes the in-process `TriggerEngine` (TD-36) in durable mode.

---

## Mode selection

| Mode          | When                         | Trigger/resume evaluation                                                                                                                 |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **durable**   | `USE_SUPABASE_PERSISTENCE=1` | The worker scans persisted Signals, schedules, timers, and approvals each tick and enqueues jobs. No in-process registry required.        |
| **in-memory** | otherwise (dev/tests)        | The in-process `TriggerEngine` fires runs synchronously from the `SignalBus`; approvals/timers resume inline. Unchanged legacy behaviour. |

The active path is exported as `workflowTriggerPath` (`@/services/jobs`) and
surfaced at `POST /api/worker` (`triggerPath`) and `GET /api/worker/health`
(`mode`). In durable mode **no `TriggerEngine` registration is required** for
correctness.

---

## Worker pass ordering

Each cron tick runs `LeasedBackgroundWorker.tick()` in this fixed sequence. Steps
2–5 are **pre-claim passes** (they enqueue the jobs that step 6 then drains in the
same tick). Every pass is **failure-isolated** — a throwing pass is logged
(`worker.pass.failed`) and skipped, never blocking the others or the job drain.

1. **Reclaim** expired job leases (crash recovery).
2. **Signal triggers** — scan persisted Signals after a per-workspace cursor →
   `workflow.run`.
3. **Schedules** — compute due occurrences → `workflow.run`.
4. **Timers** — claim due timers → `workflow.resume`.
5. **Approval resumes** — catch up decided-but-unresumed approvals →
   `workflow.resume`.
6. **Claim** due/recoverable jobs (`SKIP LOCKED`).
7. **Execute** each job through its registered handler (`workflow.run` /
   `workflow.resume`).
8. **Heartbeat** + health metrics.

Batch sizes are bounded (`app_claim_due_*` cap at 500; signal scan at 1000) and
observable via the heartbeat + health endpoint.

---

## Signal triggers (D-665/D-666)

The `DurableTriggerEvaluator` (pure, unit-tested) reads persisted Signals after a
monotonic per-workspace `trigger_scan_cursor` and, for each matching active
workflow, calls `app_claim_trigger_run` — a single transaction that dedups on
`trigger_claims`, creates one `pending` run, and enqueues one `workflow.run` job.

- **First sight** initializes the cursor to the current signal frontier
  (future-only) so a newly-activated workflow fires on future signals, not history.
- The cursor is a **progress marker only** — dedup is authoritative in
  `trigger_claims`. A crash before the cursor advances re-scans and dedups; a crash
  after never skips unclaimed work.
- Workflow-emitted signals (`source: 'workflows'`) are skipped (no self-cascade).

## Schedules (D-667)

Interval schedules (`WorkflowTrigger.intervalMs`) are evaluated by
`DurableScheduleEvaluator` (pure). Occurrences are anchored **deterministically**
at the immutable version's `createdAt`:

```
boundary = anchor + floor((now - anchor) / intervalMs) * intervalMs
```

- **Catch-up policy:** only the **single most-recent missed occurrence** is claimed
  per pass — a worker down for many intervals fires once, never an unbounded
  historical backlog.
- **Occurrence identity:** `${versionId}:sched${triggerIndex}:${boundaryMs}` —
  stable across workers/ticks. Dedup is authoritative in `schedule_occurrences`
  (unique `(workspace, workflow, occurrence_key)`).
- Each occurrence gets a **new root correlation**; the scheduled boundary time is
  retained on the run trigger (`{type:'schedule', ref, scheduledAt}`) as causation,
  distinct from processing time.
- `app_claim_schedule_run` dedups + creates the run + enqueues `workflow.run` in one
  transaction.

## Timers (D-668)

A `delay` node suspends a run (`waiting_timer`) and **persists a `workflow_timers`
row** (`createTimer`, idempotent on `(run_id, node_id)`) with `due_at = resumeAt`.
There is no in-process scheduler.

- `app_claim_due_timers` atomically claims due, unclaimed timers whose run is
  **non-terminal** (`SKIP LOCKED`, bounded), sets `claimed_at` (the consume marker),
  and enqueues one `workflow.resume` job **in the same statement** — so a crash
  leaves neither a claim without its job nor a job without its claim.
- **Overdue timers after downtime** are simply still-due and claimed on the next
  tick.
- Terminal runs' timers are never resumed.

## Approvals (D-668)

In **durable mode**, an approval decision does **not** execute the workflow inside
the deciding HTTP request. `WorkflowService.decideApproval`:

1. Authorizes (RBAC unchanged, in the service).
2. Persists the decision transactionally — decided **once** (guarded on
   `pending`); duplicate requests are idempotent (`conflict`).
3. Enqueues exactly one `workflow.resume` job via `app_claim_approval_resume`
   (fast path; dedup on a stable `trigger_claims` key `approval-resume:<id>`).

If the fast-path enqueue is lost to a crash, the **approval-resume catch-up pass**
(`app_claim_due_approval_resumes`) finds decided approvals whose run still waits
and that have no resume claim, and enqueues — so the persisted decision alone
guarantees eventual resumption. Rejected approvals resume the same way and follow
the runtime's existing rejected-branch/terminal behaviour.

In **in-memory mode** (no injected `DurableApprovalResumer`), the decision resumes
synchronously as before — behaviour-equivalent.

---

## The `workflow.run` / `workflow.resume` handlers

Both handlers (`services/jobs/workflow-durable.ts`, server-only) share the same
trust boundary:

- Validate the server-derived payload (`zod`); the workspace is re-derived from the
  **job envelope**, never trusted from the payload (cross-workspace → reject).
- Load the authoritative, **workspace-scoped** `WorkflowRun` + pinned
  `WorkflowVersion`. Reject stale/mismatched/malformed; safely **no-op terminal
  runs**.
- Delegate to `WorkflowService.runEnqueued` / `resumeEnqueued` — never business
  logic in the worker route.

`resumeEnqueued` additionally verifies the **resume cause matches the current
suspension** (`timer` ⇒ `waiting_timer`; `approval` ⇒ `waiting_approval` + a
decided approval); a stale/mismatched resume is dropped idempotently.

Clients never choose job kind, run id, workspace id, correlation id, or resume
metadata — all are server-derived in the RPCs/handlers.

---

## Concurrency, idempotency & recovery

| Property                               | Mechanism                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| No duplicate schedule runs             | `schedule_occurrences` unique key                                                            |
| No duplicate timer resumes             | `workflow_timers.claimed_at` set atomically with enqueue; `SKIP LOCKED`                      |
| No duplicate approval resumes          | `trigger_claims` key `approval-resume:<id>` (fast path + catch-up share it)                  |
| Repeated cron is harmless              | every claim is dedup-guarded                                                                 |
| Repeated `workflow.resume` is harmless | terminal/cause-mismatch no-op; runtime skips completed nodes                                 |
| No concurrent same-run advance         | one job per run/cause (claim) + job lease (`SKIP LOCKED`)                                    |
| Lost lease can't finalize              | worker completes only the leased job; runtime checkpoints per node                           |
| Stale run/version rejected             | authoritative load + version-match guard                                                     |
| Archived workflow after enqueue        | the run is already committed; run executes, but no _new_ runs start (listActive excludes it) |
| Terminal runs don't resume             | explicit `isRunTerminal` no-op + SQL `status not in (terminal)`                              |
| Failed enqueue after claim             | claim + enqueue are one transaction/statement — recoverable                                  |

**Run-level concurrency** is inherited from the queue: exactly one job per
run/cause (the claim) × at most one worker per job (the lease) × idempotent runtime
(completed steps skip by node id). No separate run-lease protocol is introduced.

---

## Correlation & causation

- Signal runs inherit the source signal's correlation; causation = the signal id.
- Schedule runs get a **new root correlation** per occurrence; causation = the
  scheduled boundary time (`scheduledAt`).
- Timer/approval resumes **preserve the run's existing correlation**; causation =
  the timer id / approval id (carried as `causeId` in the resume payload, server-side).

Resume emits honest Signals: `workflow.resume.started` / `.completed` / `.failed`,
plus the worker's `worker.pass.failed` and `worker.heartbeat`.

---

## Health & Metrics

`GET /api/worker/health` (CRON_SECRET-guarded) returns aggregate measurements only
(no per-row data, no secrets), `null` where genuinely unmeasurable:

| Field                                   | Source                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `overdueTimers`, `oldestOverdueTimerMs` | `workflow_timers` (unclaimed, due)                                                                     |
| `pendingApprovalResumes`                | decided approvals whose run waits, unresumed                                                           |
| `resumeQueueDepth`, `oldestResumeJobMs` | `jobs` where kind `workflow.resume`, queued                                                            |
| `scheduleBacklog`                       | `null` — interval schedules fire only the most-recent occurrence, so there is no meaningful DB backlog |
| `workerPasses`                          | per-pass last run / last success / last failure (worker in-memory; ephemeral)                          |

DB aggregates come from `app_durable_health`. In in-memory mode all DB aggregates
are `null` (never fabricated).

---

## Security posture

- All claim/enqueue/health RPCs are `security definer`, **service-role-only**
  (revoked from `public`/`anon`/`authenticated`), and workspace-scoped.
- Adapters query with explicit workspace predicates; infra tables
  (`jobs`, `trigger_claims`, `schedule_occurrences`, `trigger_scan_cursor`,
  `workflow_timers` writes) are server/worker-only.
- The worker endpoints require `CRON_SECRET` when configured.
- No client-controlled correlation/causation/job-kind/run-id/workspace-id.
- At-least-once delivery never produces duplicate side effects (dedup + idempotent
  handlers).

See also: [`worker.md`](./worker.md), [`workflows.md`](./workflows.md),
[`database.md`](./database.md), [`persistence.md`](./persistence.md),
[`staging.md`](./staging.md), [`operations-runbook.md`](./operations-runbook.md).
