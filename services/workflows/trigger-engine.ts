import type { SignalBus, SignalSubscriptionHandle } from '@/lib/signals/bus';
import type { Signal } from '@/lib/signals/types';
import type { Workflow, WorkflowRunTrigger, WorkflowVersion } from '@/lib/workflows/types';

/** Called when a trigger fires — the service starts a run from it. */
export type TriggerFire = (
  workflow: Workflow,
  version: WorkflowVersion,
  trigger: WorkflowRunTrigger,
) => Promise<void>;

interface Schedule {
  workflow: Workflow;
  version: WorkflowVersion;
  intervalMs: number;
  lastRunAt: number;
}

/**
 * The trigger engine — turns platform events into workflow runs.
 *
 * - **Signal triggers** subscribe to the {@link SignalBus} (workspace-scoped, by
 *   signal type). A guard drops signals emitted BY workflows (`source:
 *   'workflows'`) so a workflow that emits a signal can never trigger itself into
 *   an infinite cascade.
 * - **Schedule triggers** are held in an in-process registry; `runDue(nowMs)`
 *   fires the ones whose interval has elapsed. (A production timer/worker is
 *   future work — TD; the registry is the seam.)
 *
 * Registration is driven by the definition lifecycle: a workflow registers when
 * it goes `active` and unregisters when it is paused/archived.
 */
export class TriggerEngine {
  private readonly handles = new Map<string, SignalSubscriptionHandle[]>();
  private readonly schedules = new Map<string, Schedule[]>();

  constructor(
    private readonly bus: SignalBus,
    private readonly fire: TriggerFire,
  ) {}

  register(workflow: Workflow, version: WorkflowVersion): void {
    this.unregister(workflow.id);
    const subs: SignalSubscriptionHandle[] = [];
    const scheds: Schedule[] = [];

    for (const trigger of version.triggers) {
      if (trigger.type === 'signal' && trigger.signalType) {
        const handle = this.bus.subscribe(
          { workspaceId: workflow.workspaceId, types: [trigger.signalType] },
          (signal: Signal) => {
            if (signal.source === 'workflows') return; // no self-trigger cascades
            void this.fire(workflow, version, { type: 'signal', ref: signal.id });
          },
        );
        subs.push(handle);
      } else if (trigger.type === 'schedule' && trigger.intervalMs) {
        scheds.push({ workflow, version, intervalMs: trigger.intervalMs, lastRunAt: 0 });
      }
    }

    if (subs.length > 0) this.handles.set(workflow.id, subs);
    if (scheds.length > 0) this.schedules.set(workflow.id, scheds);
  }

  unregister(workflowId: string): void {
    this.handles.get(workflowId)?.forEach((h) => h.unsubscribe());
    this.handles.delete(workflowId);
    this.schedules.delete(workflowId);
  }

  /** Fire every schedule whose interval has elapsed as of `nowMs`. */
  async runDue(nowMs: number): Promise<number> {
    let fired = 0;
    for (const scheds of this.schedules.values()) {
      for (const sched of scheds) {
        if (nowMs - sched.lastRunAt >= sched.intervalMs) {
          sched.lastRunAt = nowMs;
          await this.fire(sched.workflow, sched.version, { type: 'schedule', ref: String(nowMs) });
          fired += 1;
        }
      }
    }
    return fired;
  }

  /** Test/inspection helper: how many workflows have live registrations. */
  registeredCount(): number {
    return new Set([...this.handles.keys(), ...this.schedules.keys()]).size;
  }
}
