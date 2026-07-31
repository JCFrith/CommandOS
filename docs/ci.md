# Continuous Integration

CommandOS runs two GitHub Actions workflows with deliberately separate responsibilities:

| Workflow                               | File                                          | Trigger                               | Cost                  | Purpose                                                                                   |
| -------------------------------------- | --------------------------------------------- | ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| **CommandOS CI**                       | `.github/workflows/ci.yml`                    | every PR, push to `main`, manual      | fast, no credentials  | the definition-of-done gate: lint · typecheck · unit tests · build                        |
| **Production Validation (Sprint 6.5)** | `.github/workflows/production-validation.yml` | **manual only** (`workflow_dispatch`) | slow, database-backed | the release gate: real PostgreSQL, migrations, RLS, concurrency, recovery, smoke, EXPLAIN |

The split is intentional (see [D-661](../DECISIONS.md)): CI must be fast and runnable on
untrusted PRs with **no secrets**, so it never touches a database. Production
validation is expensive, fail-closed, and database-backed, so it is never run
automatically on ordinary PRs.

## CommandOS CI

Runs on `pull_request`, `push` to `main`, and manual `workflow_dispatch`.

- **Node 22**, `npm ci` against the committed `package-lock.json`, npm cache enabled.
- Runs, in order and with **no step skipped**: `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- `npm test` runs **only** `tests/unit/**` (the DB-backed `tests/integration/**`
  suites are excluded by `vitest.config.ts`), so CI needs **no** Supabase or
  production credentials.
- **Concurrency:** a new push to a PR cancels the in-flight run for that PR;
  `main` runs are keyed per-SHA so a release run is never cancelled by a peer.
- **Permissions:** `contents: read` only — least privilege. A fork PR cannot read
  secrets or write to the repo.
- **Timeout:** 20 minutes.
- **Artifacts on failure:** each gate tees its output to `ci-logs/`; on failure the
  directory is uploaded as `ci-logs-<run_id>` (14-day retention). No secrets are
  written to these logs.

### Running it locally

CI runs exactly the definition-of-done gates from `CLAUDE.md`:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If those pass locally on Node 22, CI will pass.

## Requiring CI as a status check (branch protection)

CI is authored to be a **required status check**, but branch protection must be
enabled by a repository admin — it is a repository setting, not something a
workflow can grant itself. After CI has run at least once (so GitHub knows the
check name), an admin should:

**GitHub UI** — Settings → Branches → Add branch ruleset (or classic protection)
for `main`:

1. **Require a pull request before merging.**
2. **Require status checks to pass before merging** → add the check
   **`lint · typecheck · test · build`** (the job name from `ci.yml`).
3. **Require branches to be up to date before merging** (recommended).
4. Optionally require linear history and signed commits per team policy.

**GitHub CLI** (requires admin on the repo):

```bash
gh api -X PUT repos/:owner/:repo/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=lint · typecheck · test · build' \
  -f 'enforce_admins=false' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -f 'restrictions='
```

> This repository's tooling does not configure branch protection automatically —
> it requires admin permissions and is a deliberate, human-owned policy decision.
> Enable it via the steps above once CI is green.

## What CI does NOT do

- It does **not** run the database-backed integration suites, migrations, RLS,
  concurrency, recovery, smoke, or EXPLAIN checks — those are the manual
  **Production Validation** workflow (see [production-validation.md](./production-validation.md)).
- It does **not** deploy. Deployment is documented in [deployment.md](./deployment.md).
- It does **not** require or read any secret.
