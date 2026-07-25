# Observability — Metrics & Health

Reusable observability models computed **from Signals** wherever possible, so
there is a single source of truth (the event stream) rather than a parallel
metrics pipeline that can drift. Both are pure functions over a set of signals /
observed facts — no side effects, safe to compute on demand in an RSC.

## Metrics (`lib/signals/metrics.ts`)

`computeMetrics(signals): SignalMetrics`

| Field                       | Meaning                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `total`                     | signal count                                                       |
| `bySeverity`                | count per `SignalSeverity`                                         |
| `byCategory`                | count per `SignalCategory`                                         |
| `bySource`                  | count per `SignalSource`                                           |
| `execution`                 | `ExecutionMetrics` (below)                                         |
| `throughputPerMinute`       | signals per minute across the observed window (null if <2 signals) |
| `windowStart` / `windowEnd` | ISO bounds of the observed signals                                 |

`ExecutionMetrics` is derived from the runtime's terminal execution signals
(`execution.completed|failed|timed_out|cancelled`) and `execution.retried`,
reading the structured stats each carries in its payload:

| Field                                                       | Source                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `total` / `completed` / `failed` / `timedOut` / `cancelled` | outcome counts                                                   |
| `retries`                                                   | count of `execution.retried` signals                             |
| `successRate` / `failureRate`                               | over terminal (completed + failed + timedOut); null with no data |
| `avgDurationMs`                                             | mean execution duration (`durationMs`)                           |
| `avgProviderLatencyMs`                                      | mean measured provider-call latency (`providerLatencyMs`)        |
| `totalTokens` / `estimatedCostUsd`                          | summed from payloads                                             |
| `costEstimated`                                             | true if any contributing figure was an upstream estimate         |

**Honesty:** figures that are upstream estimates (dev token/cost accounting) stay
labelled `estimated` — the metrics and UI never present an approximation as a
measured value. Rates are `null`, not `0`, when there is no data.

## Health (`lib/signals/health.ts`)

`computeHealth(inputs): PlatformHealth` from already-observed facts:
`{ providerAvailable, runtimeAvailable, metrics, bus, now }`.

`HealthStatus`: `healthy` / `warning` / `degraded` / `unavailable` / `unknown`.

| Subsystem    | Rule                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `provider`   | `providerAvailable` → `healthy`, else `unavailable` (honest — no model provider configured)                                |
| `runtime`    | no executions → `unknown`; failure rate ≤ 10% → `healthy`, ≤ 33% → `warning`, else `degraded`; no provider → `unavailable` |
| `signal-bus` | `failedDeliveries === 0` → `healthy`; small ratio → `warning`; large ratio → `degraded`                                    |

`PlatformHealth.overall` is the worst subsystem status (`worstStatus`). The same
`SubsystemHealth` shape describes any future subsystem, so the health overview
extends without a redesign. Availability is read from configuration
(`isOpenAIConfigured`) in `services/signals/index.ts` — never fabricated.

## Where they surface

`SignalsService.metrics(ctx)` and `.health(ctx)` scope to the caller's workspace
and render on `/console/signals` (the metrics summary + health overview cards,
including current provider and runtime status). ⌘K → **View Runtime & Provider
Health** deep-links to the health view.
