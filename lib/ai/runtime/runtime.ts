import { estimateCost, type TokenUsage } from './accounting';
import { createCancellation, type CancellationToken } from './cancellation';
import {
  canTransition,
  type Execution,
  type ExecutionError,
  type ExecutionEvent,
  type ExecutionEventType,
  type ExecutionRequest,
  type ExecutionStatus,
} from './execution';
import { executionLogger, toExecutionLog, type ExecutionLogger } from './logging';
import { runWithRetry } from './retry';
import { ProviderError, type ModelProvider, type ModelResponse } from '@/lib/ai/provider/provider';
import type { SignalPublisher } from '@/lib/signals/bus';
import type { SignalSeverity } from '@/lib/signals/types';
import { createSignal, type SignalDeps } from '@/lib/signals/signal';
import { continueChain } from '@/lib/signals/correlation';

/** Injectable clock / id / sleep / monotonic + logger for determinism + audit. */
export interface RuntimeDeps {
  clock: () => string;
  monotonic: () => number;
  sleep: (ms: number) => Promise<void>;
  id: () => string;
  logger: ExecutionLogger;
}

const defaultDeps = (): RuntimeDeps => ({
  clock: () => new Date().toISOString(),
  monotonic: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  id: () => crypto.randomUUID(),
  logger: executionLogger,
});

/**
 * The reusable AI execution runtime.
 *
 * `run()` drives one synchronous execution end-to-end: emit lifecycle events,
 * call the provider through the retry policy, enforce the timeout and
 * cancellation via `AbortSignal`, account tokens/cost, validate the structured
 * output, and log a secret-free record. The architecture (kind + status set +
 * cancellation + events) supports async / scheduled / autonomous execution
 * later without changing callers. Depends only on the {@link ModelProvider}
 * interface, so the model backend swaps freely.
 */
export class ExecutionRuntime {
  private readonly deps: RuntimeDeps;
  private readonly signalDeps: SignalDeps;

  constructor(
    private readonly provider: ModelProvider,
    deps: Partial<RuntimeDeps> = {},
    /**
     * Optional Signal publisher. When provided, the runtime emits execution
     * lifecycle Signals (started / completed / failed / timed_out / cancelled /
     * retried) tagged with the request's correlation id, so an execution is
     * observable on the Signal timeline. Omitted in isolated runtime tests;
     * wired to the platform bus in production.
     */
    private readonly publisher?: SignalPublisher,
  ) {
    this.deps = { ...defaultDeps(), ...deps };
    this.signalDeps = { id: this.deps.id, now: this.deps.clock };
  }

  /** Whether the underlying provider is configured and ready. */
  isAvailable(): boolean {
    return this.provider.isAvailable();
  }

  /** Emit an execution lifecycle Signal (best-effort — never breaks a run). */
  private async emitExecutionSignal(
    context: Execution<unknown>['context'],
    requestId: string,
    type: string,
    summary: string,
    severity?: SignalSeverity,
    payload?: Record<string, string | number | boolean>,
  ): Promise<void> {
    if (!this.publisher) return;
    try {
      const signal = createSignal(
        {
          type,
          workspaceId: context.workspaceId,
          correlation: continueChain(context.correlationId ?? requestId, null),
          actorId: context.operatorId,
          actorName: context.operatorName,
          summary,
          subjectType: context.subjectType ?? 'execution',
          subjectId: context.subjectId ?? requestId,
          severity,
          payload,
        },
        this.signalDeps,
      );
      await this.publisher.publish(signal);
    } catch {
      // Observability must never break the execution.
    }
  }

  async run<T>(request: ExecutionRequest<T>): Promise<Execution<T>> {
    const { clock, monotonic, sleep, id, logger } = this.deps;
    const createdAt = clock();
    const startedMono = monotonic();
    const events: ExecutionEvent[] = [];
    let status: ExecutionStatus = 'queued';

    const emit = (type: ExecutionEventType, next: ExecutionStatus, detail?: string) => {
      if (next !== status && !canTransition(status, next)) return;
      status = next;
      events.push({ at: clock(), type, status, detail });
    };
    emit('created', 'queued');

    // Combine the caller's cancellation with a timeout into one signal.
    const combined = createCancellation();
    const userToken: CancellationToken | undefined = request.token;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      combined.cancel('timeout');
    }, request.timeoutMs);
    userToken?.onCancelled(() => combined.cancel('cancelled'));
    if (userToken?.isCancelled) combined.cancel('cancelled');

    const promptVersion =
      typeof request.metadata.promptVersion === 'string' ? request.metadata.promptVersion : null;

    let response: ModelResponse | null = null;
    let attempts = 1;
    let error: ExecutionError | null = null;
    let providerLatencyMs = 0;
    const retryDelays: number[] = [];

    await this.emitExecutionSignal(
      request.context,
      request.id,
      'execution.started',
      'Execution started',
      'trace',
    );

    try {
      emit('started', 'pending');
      emit('started', 'running');
      const messages = request.conversation.toMessages();
      const result = await runWithRetry(
        async (attempt) => {
          attempts = attempt; // captured even if this attempt ultimately throws
          const callStarted = monotonic();
          try {
            return await this.provider.complete(
              {
                messages,
                structuredOutput: this.provider.capabilities().structuredOutput
                  ? request.outputSpec
                  : undefined,
                timeoutMs: request.timeoutMs,
              },
              combined.token.signal,
            );
          } finally {
            // Latency of the last (settled) provider call — a real measurement.
            providerLatencyMs = Math.max(0, Math.round(monotonic() - callStarted));
          }
        },
        request.retryPolicy,
        {
          token: combined.token,
          sleep,
          isRetryable: (e) =>
            e instanceof ProviderError && e.retryable && !combined.token.isCancelled,
          onRetry: (attempt, delayMs) => {
            emit('retrying', 'running', `attempt ${attempt} in ${delayMs}ms`);
            retryDelays.push(delayMs);
          },
        },
      );
      response = result.value;
      attempts = result.attempts;
    } catch (e) {
      error = classifyError(e, { timedOut, cancelled: userToken?.isCancelled ?? false });
    } finally {
      clearTimeout(timer);
    }

    let result: Execution<T>['result'] = null;
    if (response && !error) {
      const parsed = parseAndValidate(request, response.content);
      if (parsed.ok) result = parsed.result;
      else error = parsed.error;
    }

    if (error) {
      emit(
        error.code === 'timeout'
          ? 'timed_out'
          : error.code === 'cancelled'
            ? 'cancelled'
            : 'failed',
        error.code === 'timeout'
          ? 'timed_out'
          : error.code === 'cancelled'
            ? 'cancelled'
            : 'failed',
        error.message,
      );
    } else {
      emit('completed', 'completed');
    }

    const usage: TokenUsage = response?.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimated: true,
    };
    const model = response?.model ?? this.provider.id;
    const latencyMs = Math.max(0, Math.round(monotonic() - startedMono));

    const execution: Execution<T> = {
      id: id(),
      requestId: request.id,
      kind: request.kind,
      context: request.context,
      status,
      result,
      error,
      metadata: {
        provider: this.provider.id,
        model,
        usage,
        cost: estimateCost(model, usage),
        latencyMs,
        attempts,
        promptVersion,
        toolCalls: 0,
      },
      events,
      createdAt,
      completedAt: clock(),
    };

    await logger.record(toExecutionLog(execution));

    // Emit retry + terminal execution Signals (best-effort, after logging so the
    // durable log is written even if emission is a no-op). Ordered so the chain
    // reads started → retried… → terminal.
    for (let i = 0; i < retryDelays.length; i++) {
      await this.emitExecutionSignal(
        request.context,
        request.id,
        'execution.retried',
        `Retry attempt ${i + 2}`,
        'notice',
        { attempt: i + 2, delayMs: retryDelays[i]! },
      );
    }
    const terminal = terminalSignal(execution.status);
    if (terminal) {
      await this.emitExecutionSignal(
        request.context,
        request.id,
        terminal.type,
        terminal.summary(execution),
        terminal.severity,
        {
          outcome: execution.status,
          durationMs: latencyMs,
          providerLatencyMs,
          attempts,
          retries: Math.max(0, attempts - 1),
          totalTokens: usage.totalTokens,
          costUsd: execution.metadata.cost.amount,
          estimated: usage.estimated || execution.metadata.cost.estimated,
        },
      );
    }

    return execution;
  }
}

/** Map an execution's terminal status to the Signal it emits. */
function terminalSignal(
  status: ExecutionStatus,
): { type: string; severity: SignalSeverity; summary: (e: Execution<unknown>) => string } | null {
  switch (status) {
    case 'completed':
      return {
        type: 'execution.completed',
        severity: 'info',
        summary: (e) => `Execution completed in ${e.metadata.latencyMs}ms`,
      };
    case 'failed':
      return {
        type: 'execution.failed',
        severity: 'error',
        summary: (e) => `Execution failed: ${e.error?.message ?? 'unknown error'}`,
      };
    case 'timed_out':
      return {
        type: 'execution.timed_out',
        severity: 'error',
        summary: () => 'Execution timed out',
      };
    case 'cancelled':
      return {
        type: 'execution.cancelled',
        severity: 'warning',
        summary: () => 'Execution cancelled',
      };
    default:
      return null;
  }
}

function classifyError(e: unknown, ctx: { timedOut: boolean; cancelled: boolean }): ExecutionError {
  if (ctx.timedOut) {
    return {
      code: 'timeout',
      catalogCode: 'CMD-AI-003',
      message: 'The AI assistant took too long to respond. Please try again.',
      retryable: true,
    };
  }
  if (ctx.cancelled) {
    return {
      code: 'cancelled',
      catalogCode: 'CMD-AI-005',
      message: 'The run was cancelled.',
      retryable: false,
    };
  }
  if (e instanceof ProviderError) {
    if (e.code === 'timeout') {
      return { code: 'timeout', catalogCode: e.catalogCode, message: e.message, retryable: true };
    }
    if (e.code === 'unavailable') {
      return {
        code: 'unavailable',
        catalogCode: e.catalogCode,
        message: e.message,
        retryable: false,
      };
    }
    return {
      code: 'provider_failed',
      catalogCode: e.catalogCode,
      message: e.message,
      retryable: e.retryable,
    };
  }
  // Unknown error — never leak internals.
  return {
    code: 'provider_failed',
    catalogCode: 'CMD-AI-002',
    message: 'The AI assistant could not complete this request. Please try again.',
    retryable: true,
  };
}

function parseAndValidate<T>(
  request: ExecutionRequest<T>,
  content: string,
): { ok: true; result: { output: T; raw: string } } | { ok: false; error: ExecutionError } {
  const invalid: ExecutionError = {
    code: 'invalid_output',
    catalogCode: 'CMD-AI-004',
    message: 'The AI returned a response in an unexpected format.',
    retryable: false,
  };
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, error: invalid };
  }
  const parsed = request.outputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: invalid };
  return { ok: true, result: { output: parsed.data, raw: content } };
}
