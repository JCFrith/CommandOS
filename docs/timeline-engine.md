# Timeline Engine

Reusable timeline generation (`lib/signals/timeline.ts`). Timelines are generated
**from Signals** rather than from per-feature history tables, so any domain —
Operations, Agents, Executions, a Signal's own correlation chain, or a future
subsystem — gets a consistent, chronological view for free. Pure functions; feed
them the relevant signals and they return ordered, presentation-ready entries.

## Contracts

### `TimelineEntry`

A presentation-ready projection of a Signal: `{ id, at, type, source, category,
severity, title, summary, actorName, correlationId, parentId, subjectType,
subjectId }`.

### `buildTimeline(signals, options?) → TimelineEntry[]`

Orders entries newest-first (`order: 'desc'`, default) or oldest-first
(`'asc'`), with an optional `limit`. This is the workspace **activity feed** when
given all of a workspace's signals.

### `buildSubjectTimeline(signals, subjectType, subjectId, options?)`

Filters to one subject then builds a timeline — the per-entity history for an
operation or agent, assembled from that entity's signals. The signal detail page
renders this for the signal's subject.

### `buildCorrelationChains(signals) → CorrelationChain[]`

Groups signals by `correlationId` into chains, each ordered oldest-first (causal
order). A `CorrelationChain` is `{ correlationId, entries, start, end,
severities }`, and chains are returned most-recently-active first. This is how an
execution flow reads end to end:

```
agent.execution.started → execution.started → execution.retried → execution.completed → agent.execution.completed
```

## Relationship to the existing per-feature timelines

The Sprint 3/4 `OperationActivity` and `AgentActivity` timelines (and the
`ExecutionLogger`) are **unchanged** — they remain the authoritative history for
their detail pages, so existing behavior is preserved exactly. The signal-derived
timeline engine powers the new Signals surfaces (activity feed, subject timeline,
correlation view). Unifying the per-feature timelines onto this engine — deriving
an operation's/agent's history entirely from its Signals — is deliberately
deferred to avoid destabilizing merged features (**TD-23**); the engine is built
and proven so that migration is a UI swap, not a redesign.

## Where it surfaces

`SignalsService.timeline(ctx, query)` and `.correlations(ctx, correlationId?)`
scope to the caller's workspace and render on `/console/signals` (the activity
feed and the correlation view) and `/console/signals/[id]` (subject timeline +
correlation chain). ⌘K → **View Correlations** deep-links to the correlation
view.
