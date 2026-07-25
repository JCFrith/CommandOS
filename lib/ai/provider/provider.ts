import type { Message } from '@/lib/ai/conversation/conversation';
import type { TokenUsage } from '@/lib/ai/runtime/accounting';

/**
 * The AI provider abstraction, with concerns explicitly separated:
 *
 * - **Provider**  — {@link ModelProvider}: identity, availability, capabilities.
 * - **Model**     — resolved server-side inside the provider (never from a
 *   request), so a client can never select or inject a model.
 * - **Execution** — `complete()` runs one request; the runtime owns retry,
 *   timeout, accounting, and validation around it.
 * - **Configuration** — {@link ModelConfig}, provided by the provider from env.
 * - **Structured Output** — {@link StructuredOutputSpec} on the request.
 * - **Streaming** — {@link StreamingModelProvider} (interface only for now).
 *
 * `complete()` returns raw content + usage; parsing/validating structured output
 * is the runtime's job, so a malformed response is a handled failure, not a
 * provider concern.
 */

/** JSON-schema spec the provider passes to the model's structured-output mode. */
export interface StructuredOutputSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface ModelRequest {
  messages: Message[];
  /** Request a strict structured (JSON) response when set. */
  structuredOutput?: StructuredOutputSpec;
  /** Per-call timeout; the runtime also enforces its own ceiling. */
  timeoutMs?: number;
}

export interface ModelResponse {
  content: string;
  /** The model actually used (audit metadata — never a secret). */
  model: string;
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'error';
}

/** Static provider configuration (from env; never contains the raw key). */
export interface ModelConfig {
  provider: string;
  model: string;
}

export interface ProviderCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  toolCalls: boolean;
}

export type ProviderErrorCode = 'unavailable' | 'timeout' | 'failed';

/**
 * A safe, provider-agnostic failure. `message` is user-facing and MUST NOT
 * contain secrets, prompts, stack traces, or raw provider payloads. `catalogCode`
 * maps to `39_ERROR_CATALOG.md` (domain `AI`). `retryable` guides retry policies.
 */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly catalogCode: string,
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** A model provider. The concrete provider (OpenAI, …) is injected. */
export interface ModelProvider {
  readonly id: string;
  /** Whether the provider is configured and ready. */
  isAvailable(): boolean;
  capabilities(): ProviderCapabilities;
  /** Run one completion. Throws {@link ProviderError} on failure. */
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

// --- Streaming (interface only; not yet implemented) -----------------------

export interface ModelStreamChunk {
  /** Incremental text delta. */
  delta: string;
  done: boolean;
  /** Final usage, present on the terminal chunk. */
  usage?: TokenUsage;
}

/**
 * Streaming extension. A provider that supports token streaming implements this
 * alongside {@link ModelProvider}; the runtime will consume it once streaming is
 * enabled. Defined now so streaming needs no execution-architecture redesign.
 */
export interface StreamingModelProvider extends ModelProvider {
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamChunk>;
}

/** Type guard for providers that can stream. */
export function supportsStreaming(provider: ModelProvider): provider is StreamingModelProvider {
  return provider.capabilities().streaming && 'stream' in provider;
}
