# Signals & Observability Platform

The platform-wide event and observability system (`lib/signals/`). Introduced in
Sprint 5 as the **canonical event model** for CommandOS: every current subsystem
— Operations, Agents, the AI runtime, the provider, auth/authz, workspaces, and
the command surface — emits **Signals**, and future subsystems (Workflows,
Notifications, Integrations, Monitoring) integrate through the same platform.

It follows the existing architecture rule (`04_API_SPECIFICATION.md`):

```
UI → Feature Services → SignalBus → Repositories (SignalEventStore) → Persistence
```

**No UI component and no repository publishes directly.** Feature services
publish Signals; the [SignalBus](./signal-bus.md) distributes them; a built-in
persistence subscriber appends them to the append-only store.

## Release status

- **Additive & behavior-preserving.** Signal emission is best-effort and never
  changes a use case's result — existing Operations/Agents/runtime behavior is
  unchanged, and the per-feature `OperationActivity`/`AgentActivity` timelines
  and `ExecutionLogger` are untouched. Signals are a parallel, canonical stream.
- **Development-only stores.** `InMemorySignalEventStore` (and the in-process
  bus) are per-worker, like the other dev stores (TD-09); the durable adapter
  implements the same interfaces (TD-21).
- **Interface-only.** The [notification framework](#notification-framework) is
  contracts only — no delivery, no channel implementations (TD-22).

## Core domain (`lib/signals/types.ts`)

A **Signal** is one canonical, immutable event. Its acknowledgement/resolution
lifecycle is expressed as appended **SignalEvents** — the emitted record is never
mutated (append-only).

| Type                 | What it is                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Signal`             | id, `type`, `correlationId`, `parentId`, `workspaceId`, actor, source/category/severity, title, summary, sanitized `payload`, tags, metadata, subject, projected lifecycle (`status`/`resolution`/ack/resolved), `createdAt` |
| `SignalEvent`        | append-only lifecycle entry (`emitted`/`acknowledged`/`resolved`/`dismissed`/`reopened`)                                                                                                                                     |
| `SignalSource`       | `operations`/`agents`/`runtime`/`provider`/`auth`/`authz`/`workspace`/`commands`/`signals`                                                                                                                                   |
| `SignalSeverity`     | `trace`/`info`/`notice`/`warning`/`error`/`critical` (ranked by `SEVERITY_RANK`)                                                                                                                                             |
| `SignalCategory`     | `lifecycle`/`execution`/`security`/`system`/`interaction`                                                                                                                                                                    |
| `SignalStatus`       | `open`/`acknowledged`/`resolved` (projected from events)                                                                                                                                                                     |
| `SignalResolution`   | `unresolved`/`resolved`/`dismissed`/`expired`                                                                                                                                                                                |
| `SignalCorrelation`  | `{ correlationId, parentId }` — the chain a signal belongs to                                                                                                                                                                |
| `SignalSubscription` | a durable interest (`SignalFilter` + channel refs); consumed by future notifications                                                                                                                                         |
| `SignalFilter`       | declarative, ANDed facets (workspace, severities, `minSeverity`, categories, sources, types, statuses, correlation, subject, tags, time window, search)                                                                      |

### `createSignal(input, deps)` — `lib/signals/signal.ts`

Builds an immutable Signal. The [catalog](#the-catalog) supplies
source/category/severity/title (each overridable per emission); correlation is
preserved; lifecycle starts `open`/`unresolved`; the **payload is sanitized**.

- `sanitizePayload(payload)` — redacts secret-like keys (api key, token,
  password, authorization, credential, bearer, private key, **system prompt**,
  exact `prompt`) using camelCase-aware whole-word matching (so `totalTokens` and
  `promptVersion` survive), and bounds string length / depth / breadth so a
  payload is always safe to serialize. This is defense in depth for the invariant
  **payloads never contain API keys, system prompts, provider secrets, or raw
  tokens**.
- `emittedEvent` / `acknowledgedEvent` / `resolvedEvent` — build append-only
  lifecycle events.
- `projectLifecycle(signal, events)` — folds a signal's events into its current
  `status`/`resolution` (returns a NEW signal; the stored record is never
  mutated).

### The catalog (`lib/signals/catalog.ts`)

`SIGNAL_CATALOG` maps each signal `type` to its source/category/default severity
and a title. Emitters reference a catalogued type; the taxonomy stays consistent
and extends in one place. Representative types: `operation.created|updated|
status_changed|archived`, `agent.created|updated|activated|paused|archived`,
`agent.execution.started|completed|failed`, `execution.started|completed|failed|
retried|timed_out|cancelled`, `provider.unavailable`, `auth.succeeded|failed`,
`authz.permission_denied`, `workspace.changed`, `command.executed`.

### Filtering & subscriptions

- `matchesFilter(signal, filter)` / `selectSignals(signals, filter)` — the single
  definition of filtering, shared by the bus, store, service, and UI.
- `createSubscription` / `matchesSubscription` / `routeToSubscriptions`
  (`lib/signals/subscription.ts`) — a workspace-scoped subscription can **never**
  match another workspace's signals; a `null` scope is a deliberate
  platform-level subscription.

## Correlation (`lib/signals/correlation.ts`)

A correlation id is minted once at the head of a chain (e.g. an agent run) and
carried unchanged through every downstream step:

```
Agent run → Execution runtime → Provider call → Retry → Completion → Signal timeline → (future) Notification
     └───────────────────────────── one correlationId ─────────────────────────────┘
```

`rootCorrelation` / `childOf` / `continueChain` / `groupByCorrelation` express and
group chains. The agent service mints the id and threads it into
`ExecutionContext.correlationId`; the runtime tags every execution Signal with it,
so the whole chain is reconstructable without per-feature plumbing.

## Store, service, and UI

- **Store** — `SignalEventStore` (`lib/signals/store.ts`): append-only
  `appendSignal`/`appendEvent`, projected `getSignal`/`listSignals`, and
  `listEvents`. `InMemorySignalEventStore` is the dev implementation; every read
  is workspace-scoped.
- **Service** — `SignalsService` (`services/signals/signals-service.ts`):
  workspace-scoped `list`/`get`/`events`/`timeline`/`correlations`/`metrics`/
  `health`/`acknowledge`/`resolve`. Every query is **forcibly scoped** to
  `ctx.workspace.id` — a caller can never read, correlate, or resolve a signal
  outside their workspace. RBAC via `canViewSignals`/`canManageSignals`.
- **UI** — `/console/signals`: health overview, metrics summary, faceted filters,
  activity feed, and a correlation view; `/console/signals/[id]` shows a signal's
  payload, append-only lifecycle, correlation chain, and subject timeline. ⌘K
  actions: view/filter signals, runtime & provider health, correlations, and open
  a recent signal (`/api/signals`, workspace-scoped).

## Emission map (who emits what)

| Subsystem               | Signals                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operations service      | `operation.created` / `updated` / `status_changed` / `archived`, `authz.permission_denied`                                                                                                  |
| Agents service          | `agent.created` / `updated` / `activated` / `paused` / `archived` / `status_changed`, `agent.execution.started` / `completed` / `failed`, `provider.unavailable`, `authz.permission_denied` |
| Execution runtime       | `execution.started` / `completed` / `failed` / `retried` / `timed_out` / `cancelled` (correlated)                                                                                           |
| Auth (actions/callback) | `auth.succeeded` (personal workspace) / `auth.failed` (`system` scope, PII-free)                                                                                                            |
| Command palette         | `command.executed` (server-action mediated), `workspace.changed`                                                                                                                            |

See [signal-bus.md](./signal-bus.md), [observability.md](./observability.md), and
[timeline-engine.md](./timeline-engine.md).

## Security invariants

- **Workspace isolation** — every service/store read is scoped to
  `ctx.workspace.id`; subscriptions can't cross workspaces; auth failures are
  scoped to a reserved `system` workspace (never surfaced in a tenant view).
- **No spoofing** — the command/workspace telemetry actions resolve the workspace
  via `getWorkspaceContext`, which honors a requested id only for a workspace the
  caller belongs to (the TD-13 guard).
- **No secret/prompt/PII leakage** — payloads are sanitized; auth-failure signals
  carry no email or credentials; execution signals carry ids + safe stats only.
