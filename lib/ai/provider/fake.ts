import { estimateUsage, type TokenUsage } from '@/lib/ai/runtime/accounting';
import {
  ProviderError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ProviderCapabilities,
} from './provider';

export interface FakeModelOptions {
  /** Raw content returned on success (default `'{}'`). */
  content?: string;
  usage?: TokenUsage;
  /** Availability flag (default true). */
  available?: boolean;
  capabilities?: ProviderCapabilities;
  /** If set, `complete` throws this for the first `failTimes` calls. */
  failWith?: ProviderError;
  /** Number of initial calls that fail (default: Infinity when `failWith` set). */
  failTimes?: number;
  /** Simulated latency; honors the abort signal so timeouts/cancellation work. */
  latencyMs?: number;
}

/**
 * DETERMINISTIC generic {@link ModelProvider} for tests and local development —
 * it never calls a live model. Fully configurable: success content, usage,
 * availability, transient/permanent failures (for retry), and latency (for
 * timeout/cancellation). NOT wired into the production factory; a real run with
 * no key surfaces an honest unavailable state instead of this output.
 */
export class FakeModelProvider implements ModelProvider {
  readonly id = 'fake';
  private calls = 0;

  constructor(private readonly opts: FakeModelOptions = {}) {}

  /** Total `complete` calls — lets retry tests assert attempt counts. */
  get callCount(): number {
    return this.calls;
  }

  isAvailable(): boolean {
    return this.opts.available ?? true;
  }

  capabilities(): ProviderCapabilities {
    return this.opts.capabilities ?? { structuredOutput: true, streaming: false, toolCalls: false };
  }

  async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    this.calls++;

    if (this.opts.latencyMs && this.opts.latencyMs > 0) {
      await cancellableDelay(this.opts.latencyMs, signal);
    }
    if (signal?.aborted) {
      throw new ProviderError('timeout', 'CMD-AI-003', 'The request was cancelled.', false);
    }

    if (this.opts.failWith) {
      const failTimes = this.opts.failTimes ?? Number.POSITIVE_INFINITY;
      if (this.calls <= failTimes) throw this.opts.failWith;
    }

    const content = this.opts.content ?? '{}';
    const usage =
      this.opts.usage ?? estimateUsage(request.messages.map((m) => m.content).join('\n'), content);
    return { content, model: 'fake-model', usage, finishReason: 'stop' };
  }
}

function cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new ProviderError('timeout', 'CMD-AI-003', 'Cancelled.', false));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new ProviderError('timeout', 'CMD-AI-003', 'Cancelled.', false));
      },
      { once: true },
    );
  });
}
