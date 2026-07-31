# Deployment

How CommandOS is configured and deployed across environments. Staging-specific
provisioning + validation lives in [staging.md](./staging.md); the release gate is
[production-validation.md](./production-validation.md); CI is [ci.md](./ci.md).

## Environments at a glance

| Environment               | Persistence            | Database                            | Secrets         | Purpose                                                |
| ------------------------- | ---------------------- | ----------------------------------- | --------------- | ------------------------------------------------------ |
| **local dev**             | in-memory (default)    | none                                | none required   | `next dev`; runs without any secret                    |
| **automated CI**          | in-memory              | none                                | **none**        | fast lint/typecheck/test/build gate (`ci.yml`)         |
| **staging**               | **Supabase (durable)** | isolated staging project            | server-only     | operational rehearsal of the durable path              |
| **production-validation** | Supabase (durable)     | **disposable** local/hosted project | validation-only | fail-closed release gate (`production-validation.yml`) |
| **future production**     | Supabase (durable)     | production project                  | server-only     | real users (not yet provisioned)                       |

The **durable path is opt-in**: it activates only when
`isSupabasePersistenceEnabled()` is true (`USE_SUPABASE_PERSISTENCE=1` **and** a
configured Supabase URL/anon key **and** `SUPABASE_SERVICE_ROLE_KEY`). Otherwise the
in-memory dev adapters are used. Confirm which adapters are live with the
verification below — never assume.

## Environment variables

| Variable                         | Scope             | local | CI  | staging | prod-validation | production |
| -------------------------------- | ----------------- | :---: | :-: | :-----: | :-------------: | :--------: |
| `NEXT_PUBLIC_SUPABASE_URL`       | public (browser)  |   –   |  –  |    ✔    |       ✔¹        |     ✔      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | public (browser)  |   –   |  –  |    ✔    |       ✔¹        |     ✔      |
| `SUPABASE_SERVICE_ROLE_KEY`      | **server-only**   |   –   |  –  |    ✔    |       ✔¹        |     ✔      |
| `USE_SUPABASE_PERSISTENCE`       | server            |   –   |  –  |   `1`   |       `1`       |    `1`     |
| `CRON_SECRET`                    | **server-only**   |   –   |  –  |    ✔    |        –        |     ✔      |
| `OPENAI_API_KEY`                 | **server-only**   |  opt  |  –  |  opt²   |        –        |     ✔²     |
| `OPENAI_MODEL`                   | server (optional) |  opt  |  –  |   opt   |        –        |    opt     |
| `NEXT_PUBLIC_APP_URL`            | public            |  opt  |  –  |    ✔    |        –        |     ✔      |
| `SUPABASE_TEST_URL`              | validation-only   |   –   |  –  |    –    |        ✔        |     –      |
| `SUPABASE_TEST_ANON_KEY`         | validation-only   |   –   |  –  |    –    |        ✔        |     –      |
| `SUPABASE_TEST_SERVICE_ROLE_KEY` | validation-only   |   –   |  –  |    –    |        ✔        |     –      |
| `SUPABASE_TEST_DB_URL`           | validation-only   |   –   |  –  |    –    |        ✔        |     –      |
| `SUPABASE_TEST_JWT_SECRET`       | validation-only   |   –   |  –  |    –    |        ✔        |     –      |
| `PRODUCTION_VALIDATION`          | validation-only   |   –   |  –  |    –    |       `1`       |     –      |

¹ In production-validation these come from `supabase status` (local mode) or the
`SUPABASE_TEST_*` secrets (hosted mode) — never from a production project.
² AI features report an honest "unavailable" state when `OPENAI_API_KEY` is unset
(D-403); the app still deploys and runs.

**Rules (enforced by convention + code):**

- `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `OPENAI_API_KEY` are **server-only**
  — never `NEXT_PUBLIC_*`, never sent to the browser. Feature code reads env through
  `lib/env.ts`, not `process.env` directly.
- Only `NEXT_PUBLIC_*` values are exposed to the client bundle.
- Validation-only `SUPABASE_TEST_*` values point at a **disposable** project; the
  env validator refuses a recognized production project unless
  `ALLOW_DESTRUCTIVE_VALIDATION` is explicitly set (leave it unset).

## Deploy procedure (Vercel)

1. Set the environment variables above for the target Vercel environment
   (Preview/Production). Put every server-only value in the **Encrypted /
   server** scope — not `NEXT_PUBLIC_*`.
2. Ensure the Supabase project has the canonical migration applied
   (`supabase/migrations/*`) — see [staging.md](./staging.md) / [supabase.md](./supabase.md).
3. Deploy (`vercel deploy` / `vercel --prod`, or Git integration). The build is the
   same `npm run build` CI runs.
4. `vercel.json` registers the cron `* * * * * → /api/worker`; confirm it appears in
   the Vercel project's Cron Jobs after deploy.
5. Run the **adapter verification** and **worker verification** below before trusting
   the deployment.

## Adapter verification (are we actually durable?)

The durable path is opt-in, so a misconfiguration silently falls back to in-memory
(per-worker, non-durable). Verify explicitly:

- **Health** — `GET /api/health` (or the Signals/health surface) shows the
  `database`, `queue`, and `worker` subsystems as reachable (not `unavailable`).
- **Restart persistence** — create an Operation, then re-read it after a new request
  / cold start / redeploy. In-memory would lose it across instances; Supabase keeps it.
- **The production-validation smoke suite** prints the active adapter per interface
  and fails if any binding is still in-memory — the authoritative check. Run it in
  hosted mode against the deployed project's database (see staging.md).

If any repository binding resolves to an `InMemory*` implementation in a durable
environment, treat the deployment as **not** durable and fix the env before relying
on it.

## Worker + cron verification

- **Authorized tick:** `POST /api/worker` with `Authorization: Bearer $CRON_SECRET`
  returns a tick summary (claimed/completed/failed/reclaimed).
- **Rejected tick:** the same request **without** the secret returns `401`. Do not
  weaken this to make testing easier.
- **Heartbeat:** each tick emits a `worker.heartbeat` signal; its age is visible on
  the health/metrics surface.
- **Lease recovery:** a job whose lease expires is reclaimed on a later tick
  (validated by the recovery suite; observable via queue stats).

## Rollback

- **Application:** redeploy the previous known-good deployment (Vercel keeps
  immutable deployments — promote the prior one). No schema change is required for an
  app-only rollback because Sprint 6.5 is behavior-preserving.
- **Schema:** the canonical migration has a tested reverse in
  `supabase/rollback/` (rollback + replay reproduces the canonical schema, verified
  by the validation gate). Apply it only against a disposable/staging database, never
  production, and never as a routine step — it drops all Sprint-6.5 objects.
- **Persistence toggle:** setting `USE_SUPABASE_PERSISTENCE` back to unset reverts to
  in-memory (dev only) — this is a functional downgrade (loses durability), not a
  production rollback path.

## Production-readiness checklist

Before promoting the durable path to real users, all of these must hold:

- [ ] `CommandOS CI` green on the release commit.
- [ ] `production-validation` (hosted mode) **PASS** against the target database —
      0 required failures, 0 required skips.
- [ ] Adapter verification shows **all** bindings Supabase-backed (no in-memory).
- [ ] Worker authorized/rejected/heartbeat/lease-recovery verified on the deployment.
- [ ] RLS + workspace isolation verified against the deployed project.
- [ ] Cron `→ /api/worker` present and firing in Vercel.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` / `CRON_SECRET` / `OPENAI_API_KEY` are server-only.
- [ ] Health surface reports `database`/`queue`/`worker` healthy.
- [ ] Rollback path (redeploy previous) confirmed.
- [ ] Known limitations reviewed (durable trigger evaluation TD-36; external
      alerting absent; mid-flight cancellation TD-31).

Until every box is checked against a **real** deployment, treat production as
**not ready** — the durable path is validated in a disposable stack and rehearsed in
staging, not yet proven for production traffic.
