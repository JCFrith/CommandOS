import type { SignalPublisher } from '@/lib/signals/bus';
import type { SignalSeverity } from '@/lib/signals/types';
import { createSignal, type SignalDeps } from '@/lib/signals/signal';
import { continueChain } from '@/lib/platform/correlation';
import { runWithRetry, NO_RETRY, type RetryPolicy } from '@/lib/platform/retry';
import { createCancellation, type CancellationToken } from '@/lib/platform/cancellation';

import type {
  WorkflowNode,
  WorkflowRun,
  WorkflowRunContext,
  WorkflowStepRun,
  WorkflowVariables,
  WorkflowVersion,
} from '@/lib/workflows/types';
import { canRunTransition, isRunTerminal } from '@/lib/workflows/state-machine';
import { evaluateCondition } from '@/lib/workflows/conditions';
import { interpolate, setVariable } from '@/lib/workflows/variables';
import type { WorkflowCapabilities, WorkflowRunSink } from './ports';

/** Injectable clock / id / signal-emission deps for determinism + audit. */
export interface WorkflowRuntimeDeps {
  now: () => string;
  id: () => string;
  monotonic?: () => number;
  publisher: SignalPublisher;
  capabilities: WorkflowCapabilities;
  store: WorkflowRunSink;
}

/** The outcome of executing one node. */
type NodeOutcome =
  | { kind: 'proceed'; targets: string[]; setVars?: WorkflowVariables; detail?: WorkflowVariables }
  | { kind: 'suspend_approval'; prompt: string; approvers: 'owner' | 'admin' }
  | { kind: 'suspend_timer'; resumeAt: string }
  | { kind: 'fail'; error: string; timedOut?: boolean }
  | { kind: 'end'; status: 'completed' | 'failed' };

/**
 * The Workflow runtime — a graph orchestrator that drives one run to completion
 * or a suspension point, checkpointing each node so the run is resumable.
 *
 * It consumes ONLY the platform runtime (retry, cancellation, correlation) and
 * its injected {@link WorkflowCapabilities}/{@link WorkflowRunSink} ports — never
 * `lib/ai` or feature services directly. Every step is recorded as a
 * {@link WorkflowStepRun} and every notable moment is emitted as a correlated
 * Signal, so a run's audit history is reconstructed from Signals rather than a
 * bespoke table.
 */
export class WorkflowRuntime {
  private readonly signalDeps: SignalDeps;

  constructor(private readonly deps: WorkflowRuntimeDeps) {
    this.signalDeps = { id: deps.id, now: deps.now };
  }

  /** Start a fresh run: seed the frontier at the start node and advance. */
  async start(
    version: WorkflowVersion,
    run: WorkflowRun,
    ctx: WorkflowRunContext,
    token?: CancellationToken,
  ): Promise<WorkflowRun> {
    let next: WorkflowRun = {
      ...run,
      status: 'running',
      frontier: [version.startNodeId],
      joinArrivals: {},
      updatedAt: this.deps.now(),
    };
    await this.deps.store.saveRun(next);
    await this.emit(next, 'workflow.run.started', `run of workflow started`, undefined, {
      versionId: version.id,
    });
    next = await this.advance(version, next, ctx, token);
    return next;
  }

  /**
   * Resume a suspended run (after an approval decision or a due timer). The
   * frontier still points at the suspended node; `advance` re-evaluates it (the
   * approval/timer check now passes) and continues. Idempotent.
   */
  async resume(
    version: WorkflowVersion,
    run: WorkflowRun,
    ctx: WorkflowRunContext,
    token?: CancellationToken,
  ): Promise<WorkflowRun> {
    if (isRunTerminal(run.status)) return run;
    let next: WorkflowRun = { ...run, status: 'running', updatedAt: this.deps.now() };
    await this.emit(next, 'workflow.run.resumed', 'run resumed');
    next = await this.advance(version, next, ctx, token);
    return next;
  }

  // --- the process loop -----------------------------------------------------

  private async advance(
    version: WorkflowVersion,
    run: WorkflowRun,
    ctx: WorkflowRunContext,
    token?: CancellationToken,
  ): Promise<WorkflowRun> {
    let current = run;
    const nodeById = new Map(version.nodes.map((n) => [n.id, n]));
    const completed = new Set(
      (await this.deps.store.listSteps(current.workspaceId, current.id))
        .filter((s) => s.status === 'completed' || s.status === 'skipped')
        .map((s) => s.nodeId),
    );

    while (current.frontier.length > 0) {
      if (token?.isCancelled) return this.finish(current, 'cancelled', 'The run was cancelled.');

      const frontier = [...current.frontier];
      const nodeId = frontier.shift()!;
      current = { ...current, frontier };

      const node = nodeById.get(nodeId);
      if (!node) return this.finish(current, 'failed', `Unknown node "${nodeId}".`);
      if (completed.has(nodeId)) continue; // idempotent skip on resume

      const startedAt = this.deps.now();
      const outcome = await this.executeNode(node, current, version, ctx);

      if (outcome.kind === 'suspend_approval') {
        await this.checkpoint(current, node, 'waiting', 0, {}, null, startedAt);
        const approval = {
          id: this.deps.id(),
          runId: current.id,
          workspaceId: current.workspaceId,
          nodeId: node.id,
          prompt: outcome.prompt,
          approvers: outcome.approvers,
          status: 'pending' as const,
          decidedBy: null,
          decidedAt: null,
          comment: null,
          createdAt: this.deps.now(),
        };
        await this.deps.store.createApproval(approval);
        current = this.transition(current, 'waiting_approval', {
          frontier: [node.id, ...current.frontier],
        });
        await this.deps.store.saveRun(current);
        await this.emit(current, 'workflow.approval.requested', outcome.prompt, 'notice', {
          nodeId: node.id,
        });
        await this.emit(current, 'workflow.run.suspended', 'awaiting approval', 'trace');
        return current;
      }

      if (outcome.kind === 'suspend_timer') {
        await this.checkpoint(
          current,
          node,
          'waiting',
          0,
          { resumeAt: outcome.resumeAt },
          null,
          startedAt,
        );
        // Persist a durable timer (idempotent on run+node) so the worker can
        // resume this run when the timer comes due — no in-process scheduler.
        await this.deps.store.createTimer({
          id: this.deps.id(),
          workspaceId: current.workspaceId,
          runId: current.id,
          nodeId: node.id,
          dueAt: outcome.resumeAt,
          claimedAt: null,
        });
        current = this.transition(current, 'waiting_timer', {
          frontier: [node.id, ...current.frontier],
        });
        await this.deps.store.saveRun(current);
        await this.emit(current, 'workflow.run.suspended', 'waiting on a timer', 'trace', {
          resumeAt: outcome.resumeAt,
        });
        return current;
      }

      if (outcome.kind === 'fail') {
        await this.checkpoint(current, node, 'failed', 1, {}, outcome.error, startedAt);
        await this.emit(
          current,
          'workflow.node.failed',
          `${node.name}: ${outcome.error}`,
          'error',
          {
            nodeId: node.id,
          },
        );
        return this.finish(current, outcome.timedOut ? 'timed_out' : 'failed', outcome.error);
      }

      if (outcome.kind === 'end') {
        await this.checkpoint(current, node, 'completed', 1, {}, null, startedAt);
        completed.add(node.id);
        return this.finish(
          current,
          outcome.status,
          outcome.status === 'failed' ? 'Workflow ended in a failed state.' : null,
        );
      }

      // proceed
      const vars = outcome.setVars
        ? { ...current.variables, ...outcome.setVars }
        : current.variables;
      current = { ...current, variables: vars };
      await this.checkpoint(current, node, 'completed', 1, outcome.detail ?? {}, null, startedAt);
      completed.add(node.id);
      if (node.type !== 'start') {
        await this.emit(current, 'workflow.node.completed', `${node.name} completed`, 'trace', {
          nodeId: node.id,
        });
      }

      current = this.enqueue(version, current, outcome.targets, completed);
      await this.deps.store.saveRun(current);
    }

    return this.finish(current, 'completed', null);
  }

  /** Add targets to the frontier, honoring join arrival semantics + idempotency. */
  private enqueue(
    version: WorkflowVersion,
    run: WorkflowRun,
    targets: string[],
    completed: Set<string>,
  ): WorkflowRun {
    const frontier = [...run.frontier];
    const joinArrivals = { ...run.joinArrivals };
    const nodeById = new Map(version.nodes.map((n) => [n.id, n]));

    for (const target of targets) {
      const node = nodeById.get(target);
      if (!node || completed.has(target)) continue;
      if (node.config.type === 'join') {
        const arrivals = (joinArrivals[target] ?? 0) + 1;
        joinArrivals[target] = arrivals;
        const incoming = version.edges.filter((e) => e.to === target).length;
        const satisfied = node.config.mode === 'all' ? arrivals >= incoming : arrivals >= 1;
        const alreadyQueued = frontier.includes(target);
        if (satisfied && !alreadyQueued) frontier.push(target);
      } else if (!frontier.includes(target)) {
        frontier.push(target);
      }
    }
    return { ...run, joinArrivals, frontier, updatedAt: this.deps.now() };
  }

  // --- node execution -------------------------------------------------------

  private async executeNode(
    node: WorkflowNode,
    run: WorkflowRun,
    version: WorkflowVersion,
    ctx: WorkflowRunContext,
  ): Promise<NodeOutcome> {
    const vars = run.variables;
    const out = (labels?: (string | undefined)[]): string[] =>
      version.edges
        .filter((e) => e.from === node.id && (labels === undefined || labels.includes(e.label)))
        .map((e) => e.to);

    switch (node.config.type) {
      case 'start':
      case 'parallel':
      case 'join':
        return { kind: 'proceed', targets: out() };

      case 'set_variable': {
        const value = interpolate(node.config.valueTemplate, vars);
        return {
          kind: 'proceed',
          targets: out(),
          setVars: setVariable({}, node.config.key, value),
        };
      }

      case 'condition': {
        const result = evaluateCondition(node.config.expression, vars);
        return {
          kind: 'proceed',
          targets: out([result ? 'true' : 'false', undefined]).filter(Boolean),
          detail: { result },
        };
      }

      case 'branch': {
        const taken = node.config.branches.find((b) => evaluateCondition(b.when, vars));
        const label = taken?.label ?? 'default';
        await this.emit(run, 'workflow.branch.taken', `branch: ${label}`, 'trace', {
          nodeId: node.id,
          branch: label,
        });
        return { kind: 'proceed', targets: out([label]), detail: { branch: label } };
      }

      case 'delay': {
        if (node.config.ms <= 0) return { kind: 'proceed', targets: out() };
        const prior = (await this.deps.store.listSteps(run.workspaceId, run.id)).find(
          (s) => s.nodeId === node.id,
        );
        const resumeAt =
          typeof prior?.output.resumeAt === 'string'
            ? prior.output.resumeAt
            : new Date(new Date(this.deps.now()).getTime() + node.config.ms).toISOString();
        if (this.deps.now() >= resumeAt) return { kind: 'proceed', targets: out() };
        return { kind: 'suspend_timer', resumeAt };
      }

      case 'approval': {
        const approval = await this.deps.store.getApprovalForNode(run.workspaceId, run.id, node.id);
        if (!approval) {
          return {
            kind: 'suspend_approval',
            prompt: node.config.prompt,
            approvers: node.config.approvers,
          };
        }
        if (approval.status === 'pending') {
          return {
            kind: 'suspend_approval',
            prompt: node.config.prompt,
            approvers: node.config.approvers,
          };
        }
        if (approval.status === 'rejected')
          return { kind: 'fail', error: 'Approval was rejected.' };
        return {
          kind: 'proceed',
          targets: out(),
          detail: { approvedBy: approval.decidedBy ?? '' },
        };
      }

      case 'emit_signal': {
        await this.emit(
          run,
          node.config.signalType,
          interpolate(node.config.summaryTemplate, vars),
          undefined,
          { nodeId: node.id },
        );
        return { kind: 'proceed', targets: out() };
      }

      case 'agent_run': {
        const agentId = node.config.agentId;
        const input = interpolate(node.config.inputTemplate, vars);
        const outputVar = node.config.outputVar;
        // Hand the agent the run's correlation chain so its execution + all
        // downstream AI-runtime Signals inherit the WorkflowRun correlation id.
        const correlation = {
          correlationId: run.correlationId,
          workspaceId: run.workspaceId,
          workflowRunId: run.id,
          workflowStepRunId: node.id,
          initiatingActorId: run.startedBy,
        };
        return this.withPolicies(node, () =>
          this.deps.capabilities.runAgent(ctx, { agentId, input, correlation }),
        ).then((r): NodeOutcome => {
          if (r.timedOut)
            return { kind: 'fail', error: 'The agent step timed out.', timedOut: true };
          if (!r.ok || !r.value)
            return { kind: 'fail', error: r.error ?? 'The agent step failed.' };
          const result = r.value;
          if (!result.ok) return { kind: 'fail', error: result.error ?? 'The agent step failed.' };
          const setVars = outputVar
            ? { ...result.output, [outputVar]: result.summary }
            : result.output;
          return { kind: 'proceed', targets: out(), setVars };
        });
      }

      case 'operation_create': {
        const title = interpolate(node.config.titleTemplate, vars);
        const priority = node.config.priority;
        const outputVar = node.config.outputVar;
        return this.withPolicies(node, () =>
          this.deps.capabilities.createOperation(ctx, { title, priority }),
        ).then((r): NodeOutcome => {
          if (r.timedOut)
            return { kind: 'fail', error: 'Operation create timed out.', timedOut: true };
          if (!r.ok || !r.value)
            return { kind: 'fail', error: r.error ?? 'Operation create failed.' };
          const setVars = outputVar ? setVariable({}, outputVar, r.value.id) : {};
          return { kind: 'proceed', targets: out(), setVars };
        });
      }

      case 'operation_transition': {
        const operationId = String(vars[node.config.operationIdVar] ?? '');
        if (!operationId)
          return { kind: 'fail', error: 'No operation id in the referenced variable.' };
        const to = node.config.to;
        return this.withPolicies(node, () =>
          this.deps.capabilities.transitionOperation(ctx, { operationId, to }),
        ).then((r): NodeOutcome => {
          if (r.timedOut)
            return { kind: 'fail', error: 'Operation transition timed out.', timedOut: true };
          if (!r.ok) return { kind: 'fail', error: r.error ?? 'Operation transition failed.' };
          return { kind: 'proceed', targets: out() };
        });
      }

      case 'end':
        return { kind: 'end', status: node.config.result ?? 'completed' };
    }
  }

  /** Run an action under the node's retry policy + optional timeout. */
  private async withPolicies<T>(
    node: WorkflowNode,
    action: () => Promise<T>,
  ): Promise<{ ok: boolean; value?: T; error?: string; timedOut?: boolean }> {
    const policy: RetryPolicy = node.retry ?? NO_RETRY;
    const timeoutMs = node.timeoutMs;
    const runOnce = async (): Promise<T> => {
      if (!timeoutMs) return action();
      const cancel = createCancellation();
      const timer = setTimeout(() => cancel.cancel('timeout'), timeoutMs);
      try {
        return await Promise.race([
          action(),
          new Promise<never>((_, reject) =>
            cancel.token.onCancelled(() => reject(new Error('__timeout__'))),
          ),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      const result = await runWithRetry((_) => runOnce(), policy, {
        isRetryable: (e) => !(e instanceof Error && e.message === '__timeout__'),
      });
      return { ok: true, value: result.value };
    } catch (e) {
      if (e instanceof Error && e.message === '__timeout__') return { ok: false, timedOut: true };
      return { ok: false, error: 'The step failed.' };
    }
  }

  // --- persistence + signals ------------------------------------------------

  private async checkpoint(
    run: WorkflowRun,
    node: WorkflowNode,
    status: WorkflowStepRun['status'],
    attempts: number,
    output: WorkflowVariables,
    error: string | null,
    startedAt: string,
  ): Promise<void> {
    const step: WorkflowStepRun = {
      id: this.deps.id(),
      runId: run.id,
      workspaceId: run.workspaceId,
      nodeId: node.id,
      nodeType: node.type,
      status,
      attempts,
      output,
      error,
      startedAt,
      completedAt: status === 'waiting' ? null : this.deps.now(),
    };
    await this.deps.store.appendStep(step);
  }

  private transition(
    run: WorkflowRun,
    to: WorkflowRun['status'],
    patch: Partial<WorkflowRun> = {},
  ): WorkflowRun {
    if (!canRunTransition(run.status, to)) return { ...run, ...patch, updatedAt: this.deps.now() };
    return { ...run, ...patch, status: to, updatedAt: this.deps.now() };
  }

  private async finish(
    run: WorkflowRun,
    status: 'completed' | 'failed' | 'cancelled' | 'timed_out',
    error: string | null,
  ): Promise<WorkflowRun> {
    const finished = this.transition(run, status, {
      error,
      completedAt: this.deps.now(),
      frontier: [],
    });
    await this.deps.store.saveRun(finished);
    const type =
      status === 'completed'
        ? 'workflow.run.completed'
        : status === 'cancelled'
          ? 'workflow.run.cancelled'
          : status === 'timed_out'
            ? 'workflow.run.timed_out'
            : 'workflow.run.failed';
    const severity: SignalSeverity | undefined =
      status === 'completed' ? undefined : status === 'cancelled' ? 'warning' : 'error';
    await this.emit(finished, type, `run ${status}${error ? `: ${error}` : ''}`, severity);
    return finished;
  }

  private async emit(
    run: WorkflowRun,
    type: string,
    summary: string,
    severity?: SignalSeverity,
    payload: WorkflowVariables = {},
  ): Promise<void> {
    try {
      const signal = createSignal(
        {
          type,
          workspaceId: run.workspaceId,
          correlation: continueChain(run.correlationId, null),
          actorId: run.startedBy,
          actorName: null,
          summary,
          subjectType: 'workflow_run',
          subjectId: run.id,
          severity,
          source: 'workflows',
          payload,
        },
        this.signalDeps,
      );
      await this.deps.publisher.publish(signal);
    } catch {
      // Observability must never break a run.
    }
  }
}
