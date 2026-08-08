# Sprint 7 — Intelligence & Decision Engine · Plan

Builds only on existing seams (repository/service interfaces, Platform Runtime,
Signals, the durable `LeasedJobStore`/worker). No architecture invention.

## Baseline (post-v0.6.6)

Durable Postgres persistence + execution validated on a live staging deployment;
personal-workspace provisioning fixed; `CommandOS CI` required on protected `main`;
hosted production-validation + staging smoke are the release gates.

## Approved sequence

**Durable trigger evaluation → Decision Engine → Insights & Recommendations →
Human approval & execution.** Triggers-first is non-negotiable: intelligence that
reacts to Signals is only as reliable as signal-triggered processing. Each phase
ships as its own release; Phase 2 does not start until Phase 1 is validated in
hosted staging.

---

## Phase 1 — Durable Trigger Evaluation (approved; `v0.7.0`)

Replace instance-local workflow trigger evaluation with **durable, worker-driven**
evaluation over persisted Signals, schedules, timers, trigger claims, and the
existing leased job infrastructure. No distributed bus / Realtime / `LISTEN·NOTIFY`
/ self-invoking worker / extra scheduler (D-668). The in-process `SignalBus` keeps
its role (same-request fan-out + durable persistence); the durable path is worker-driven.

### Durable passes added to `worker.tick()`

1. **Signal triggers** — read persisted `signals` after the per-workspace cursor;
   find **active** `workflow_versions` with matching `signal` triggers; evaluate
   filters via the existing safe filter/condition boundary; derive a trusted
   occurrence identity `(workspace, workflow, version, trigger def, source signal)`;
   `claimTrigger` (authoritative dedup) → enqueue a `workflow.run` job **only on a
   won claim**; preserve source-signal correlation/causation; advance the cursor safely.
2. **Schedule triggers** — active versions with `schedule` triggers; compute due
   occurrences deterministically; stable occurrence key; claim via
   `schedule_occurrences`/`trigger_claims` → enqueue `workflow.run`. **Catch-up
   policy:** process the **most recent** missed occurrence only (no unbounded
   backlog); extensible without changing the trigger contract.
3. **Timer resumption** — due `workflow_timers` (already have `claimed_at`/`due_at`):
   claim atomically → enqueue `workflow.resume`; never before `due_at`; recover
   overdue timers; idempotent; a terminal run never resumes.
4. **Approval resumption** — an authorized approval decision persists
   transactionally and enqueues an idempotent `workflow.resume` job (no in-process
   continuation in durable mode); duplicate approvals never enqueue duplicate resumes.

### `workflow.run` / `workflow.resume` job handlers

Load the authoritative workspace-scoped `WorkflowRun` + pinned `WorkflowVersion`;
verify the payload matches stored run identity; respect run-level concurrency
(`workflow_runs.row_version`/lease); preserve correlation/causation; call
`WorkflowRuntime` through the existing service/capability boundary; checkpoint
frontier/state; complete/retry/fail honestly; reject stale/malformed/cross-workspace/
already-terminal jobs; idempotent under at-least-once. No business logic in the
worker route.

### Cursor — `trigger_scan_cursor`

Per-workspace progress marker (`workspace_id` PK, `last_signal_created_at`,
`last_signal_id`, `updated_at`). Deterministic order `created_at ASC, id ASC`
(tolerates identical timestamps). **Monotonic** advancement only; concurrency-safe
(two workers may scan the same workspace — redundant, never lost, deduped by
`trigger_claims`). The cursor is an **optimization + progress marker, not the
correctness mechanism** — `trigger_claims` is the authoritative dedup guarantee.
Crash before cursor advance ⇒ reprocessing (never a duplicate run); crash after
advance ⇒ no unclaimed work skipped. Operationally resettable without corrupting dedup.

### Concurrency, leasing, recovery

Reuse `LeasedJobStore`/`ExecutionQueue`/`JobStore`/`BackgroundWorker`, `SKIP LOCKED`,
lease-ownership checks, retry/backoff. Add run-level optimistic concurrency/leases so
two workers can't advance the same run, double-execute a node, or double-resume. A
worker that loses its lease must not finalize authoritative state. Where correctness
needs a transaction, use an **RPC/DB transaction**, not optimistic multi-call
coordination. Recover from: crash before/after enqueue, crash after cursor advance,
crash after job claim, crash mid-run, lease expiry, DB disconnect, retry exhaustion,
malformed/deleted/archived/stale/terminal references, duplicate cron — no stranded
work, no side effects beyond the documented at-least-once model.

### Correlation & Signals

Signal-triggered: inherit the source-signal correlation id; causation = source
signal / trigger occurrence; keep run→agent→AI in one chain. Scheduled: new root
correlation + occurrence identity as causation. Timer/approval resumes: reuse the
run's correlation; timer/approval as causation. Emit `workflow.*`/trigger operational
Signals (scan started/completed/failed, matched, claim won/lost, enqueued, occurrence
claimed, timer claimed, approval resume enqueued, run started/completed/failed,
backlog/cursor warnings) — no payload secrets, no per-row noise without value.

### Observability, security, schema

- **Health/Metrics** (projections, never fabricated; null/unknown when unmeasured):
  cursor age, unprocessed backlog, scan batch size, matched/deduped counts, enqueue
  failures, schedule backlog, overdue timers, `workflow.run`/`workflow.resume` queue
  depth, oldest trigger job, trigger-worker last-success/failure.
- **Security:** no cross-workspace scanning/matching; no forged occurrence ids or
  client-controlled correlation/job kinds/privileged payloads; service-role queries
  always workspace-filtered; approval-resume authorized by the service layer; no
  secret leakage; self-trigger guard; bounded backlog (DoS); at-least-once dedup;
  cursor-tamper resistance; worker endpoint auth; stale/replayed job rejection. Only
  trusted server-side code creates trigger/resume jobs.
- **Migration (smallest):** `trigger_scan_cursor` + an ordered signal-scan index +
  any run/job uniqueness for idempotency; RLS (infra/service-role-only) + grants +
  rollback + replay compatibility + production-validation assertions. Timers already
  have `claimed_at`; runs already have `row_version`/lease.

### Latency

Bounded by worker cadence (~1 min on production Pro; staging Hobby daily — documented).
No mechanism added solely for sub-minute latency (D-668).

### Gating

Durable evaluation only with persistence enabled; in-memory dev keeps the synchronous
`TriggerEngine`. Public `WorkflowService`/`WorkflowRuntime` contracts stable where possible.

### Release gate (`v0.7.0`)

Local gates + CI + hosted validation + staging smoke (signal/schedule/timer/approval

- duplicate-suppression under concurrent workers + multi-instance/redeploy + RLS/
  isolation + no in-memory registration in durable mode + health/backlog metrics) all
  green, working tree clean → PR into protected `main` → CI green + up-to-date →
  `--no-ff` merge → tag `v0.7.0`. Phase 2 does not start until this is validated.

---

## Phase 2 — Decision Engine (not started)

Policy layer consuming Signals → **proposes** actions enacted only through existing
services (Operations/Agents/Workflows), correlated + auditable via Signals, default
human-in-the-loop. Reuses the condition engine; worker-driven evaluation (Phase 1);
`decision_policies` (+ versions) and append-only `decisions`. **Blocked on Phase 1
staging validation.**

## Phase 3 — Insights & Recommendations (not started)

Read-only projections from the Signals timeline + metrics (rule-derived core;
optional honest AI summaries). No new persistence model; recommendations propose,
never enact.

## Phase 4 — Human Approval & Execution (not started)

Every automated decision is a correlated Signal + reversible action; approval reuses
the workflow-approval mechanism; execution enacts through services (idempotent,
correlated, audited); reversibility documented.

---

## Phase 1 — implementation status (on `sprint-7-durable-triggers`)

**Implemented + locally green** (lint/typecheck/300 unit tests/build):

- Durable signal-trigger evaluator + production port + `workflow.run` handler.
- Durable schedule evaluator (deterministic most-recent-missed catch-up, stable
  occurrence identity, new root correlation).
- Timer persistence (`workflow_timers` on delay suspension) + durable timer-resume
  pass + `workflow.resume` handler.
- Durable approval resumption: decision enqueues `workflow.resume` (no inline
  execution in the request) + approval-resume catch-up pass; in-memory mode resumes
  inline (equivalent).
- Ordered failure-isolated worker passes (reclaim → signal triggers → schedules →
  timers → approval resumes → claim → execute → heartbeat); per-pass metrics.
- Migration RPCs (`app_claim_schedule_run`, `app_claim_due_timers`,
  `app_claim_approval_resume`, `app_claim_due_approval_resumes`, `app_durable_health`)
  - rollback + reset; `workflow_timers.node_id` + uniqueness.
- `GET /api/worker/health` (CRON_SECRET-guarded); `workflowTriggerPath` diagnostic.
- Unit + DB-gated integration tests. Full design: `docs/durable-triggers.md`.

**Remaining before `v0.7.0` release** (human-gated, needs live infra/credentials):
hosted production validation against `commandos-staging`; staging deploy + the
signal/schedule/timer/approval staging smoke; worker/cron smoke; then the
protected-PR merge to `main` + annotated `v0.7.0` tag. See "Hosted validation" in
`docs/staging.md` and `docs/operations-runbook.md`.

---

## Design decisions (approved 2026-08-05)

- **D-665** cursor (optimization, not correctness; `trigger_claims` authoritative;
  monotonic/replayable). **D-666** durable worker execution (all trigger/resume work
  enqueued to `LeasedJobStore`; runs independent of request/instance lifetime;
  in-memory dev unchanged; contracts stable). **D-667** latency bounded by cadence
  (~1 min prod; no self-invoke/distributed/Realtime for sub-minute). **D-668** fold
  timer + approval resumption into the worker-driven architecture (materially reduces
  **TD-31**, but TD-31 stays open until mid-flight Agent/AI cancellation is
  implemented + verified). **Release:** Phase 1 ships as a dedicated `v0.7.0` before
  Decision Engine work.
