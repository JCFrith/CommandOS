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

  constructor(
    private readonly provider: ModelProvider,
    deps: Partial<RuntimeDeps> = {},
  ) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  /** Whether the underlying provider is configured and ready. */
  isAvailable(): boolean {
    return this.provider.isAvailable();
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

    try {
      emit('started', 'pending');
      emit('started', 'running');
      const messages = request.conversation.toMessages();
      const result = await runWithRetry(
        (attempt) => {
          attempts = attempt; // captured even if this attempt ultimately throws
          return this.provider.complete(
            {
              messages,
              structuredOutput: this.provider.capabilities().structuredOutput
                ? request.outputSpec
                : undefined,
              timeoutMs: request.timeoutMs,
            },
            combined.token.signal,
          );
        },
        request.retryPolicy,
        {
          token: combined.token,
          sleep,
          isRetryable: (e) =>
            e instanceof ProviderError && e.retryable && !combined.token.isCancelled,
          onRetry: (attempt, delayMs) =>
            emit('retrying', 'running', `attempt ${attempt} in ${delayMs}ms`),
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
    return execution;
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
