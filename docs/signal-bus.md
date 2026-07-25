# SignalBus

The reusable publish/subscribe hub (`lib/signals/bus.ts`) that distributes
Signals from emitters to any number of consumers. It is the seam between "a
subsystem emitted an event" and "everything that cares about that event" — and it
is shaped so a future distributed transport drops in without a redesign.

## Contracts

| Type                       | Purpose                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `SignalPublisher`          | the **narrow** capability an emitter depends on — `publish(signal)` only |
| `SignalBus`                | `publish` + `subscribe(filter, handler)` + `clear()` + `health()`        |
| `SignalHandler`            | `(signal) => void \| Promise<void>` — a subscriber                       |
| `SignalSubscriptionHandle` | `{ id, unsubscribe() }`                                                  |
| `SignalBusHealth`          | `{ subscribers, published, delivered, failedDeliveries }`                |

## Design constraints

- **Emitters depend only on `SignalPublisher`.** A feature service is injected a
  publisher (a no-op by default; the real bus in production) and never references
  the bus implementation or any subscriber. **Nothing upstream depends on
  downstream consumers** — the core decoupling rule.
- **Fan-out is isolated.** `publish` routes a signal to every subscriber whose
  `SignalFilter` matches, each invoked inside its own try/catch (async handlers
  awaited). One subscriber throwing never affects a peer or the publisher; the
  failure is counted in `health().failedDeliveries`, not propagated. Emission can
  never break a use case.
- **Correlation is preserved.** The bus passes each signal through untouched, so
  `correlationId`/`parentId` survive every hop.
- **Workspace routing.** Because routing uses `matchesFilter`, a
  workspace-scoped subscription never receives another workspace's signals.

## The in-process implementation

`InProcessSignalBus` awaits all matching handlers before `publish` resolves, so
when a feature call returns, its signals have already been delivered (and
persisted — see below). This makes emission deterministic and testable. A
distributed bus (queue, log, websocket) implements the same `SignalBus`
interface; callers do not change.

## Wiring (`lib/signals/index.ts`)

```
Feature service ──publish──▶ signalBus ──fan-out──▶ subscribers
                                 │
                                 └─(built-in)─▶ signalEventStore.appendSignal + appendEvent(emitted)
```

The singletons — `signalBus`, `signalEventStore`, and `signalPublisher` (which
**is** the bus) — are pinned to `globalThis` within a realm (like the other dev
stores) so Next's separate module graphs share one bus + store and the
**persistence subscriber** is registered exactly once. That subscriber (filter
`{}`, matches all) appends every published signal to the append-only store.
Future consumers (notifications, monitoring) subscribe to the same bus with no
change upstream.

Development-only: in-process and per-worker (TD-09/TD-21). The durable transport

- store implement these interfaces unchanged.

## Health

`bus.health()` feeds the `signal-bus` subsystem in
[observability.md](./observability.md): `failedDeliveries === 0` is healthy; a
small ratio of failures is a `warning`; a large ratio is `degraded`.
