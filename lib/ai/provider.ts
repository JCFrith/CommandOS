import type { AgentExecutionResult } from '@/types';

/**
 * A single AI model invocation, assembled entirely server-side. The `system`
 * instruction is trusted (from the prompt library); `user` carries the
 * delimited, untrusted operator content. Feature code builds this via
 * `lib/ai/prompt-builder.ts` and never lets a client supply `system`, `model`,
 * tools, or other privileged settings.
 */
export interface AIInvocation {
  system: string;
  user: string;
  /** Prompt-template version, recorded on the execution for auditability. */
  promptVersion: string;
}

/** A successful, structured, provider-agnostic result plus audit metadata. */
export interface AIResult {
  output: AgentExecutionResult;
  /** Model identifier actually used (audit metadata — never a secret). */
  model: string;
  durationMs: number;
}

export type AIErrorCode = 'unavailable' | 'timeout' | 'failed' | 'invalid_output';

/**
 * A safe, provider-agnostic AI failure. The `message` is user-facing and MUST
 * NOT contain secrets, prompts, stack traces, or provider internals. Carries an
 * error catalog code (`39_ERROR_CATALOG.md`, domain `AI`).
 */
export class AIProviderError extends Error {
  constructor(
    readonly code: AIErrorCode,
    /** Error-catalog code, e.g. `CMD-AI-003`. */
    readonly catalogCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/**
 * The application-layer AI boundary. Every model call goes through this
 * interface, so the concrete provider (OpenAI today; others later) is swapped
 * without touching services or UI — mirroring the repository pattern and the
 * `UI → Service → Adapter → Provider` rule in `04_API_SPECIFICATION.md`.
 */
export interface AIProvider {
  /** Whether this provider is configured and ready. */
  isAvailable(): boolean;
  /** Run one structured invocation. Throws {@link AIProviderError} on failure. */
  run(invocation: AIInvocation): Promise<AIResult>;
}
