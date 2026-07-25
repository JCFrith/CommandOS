import { isOpenAIConfigured } from '@/lib/env';
import { OpenAIProvider } from '@/lib/ai/openai-provider';
import type { AIProvider } from '@/lib/ai/provider';

export type { AIProvider, AIInvocation, AIResult } from '@/lib/ai/provider';
export { AIProviderError } from '@/lib/ai/provider';

/**
 * The production AI provider. Always the real OpenAI adapter — there is no
 * silent fake fallback, so an unconfigured environment surfaces an honest
 * "unavailable" state (the service checks {@link isAIAvailable} before running)
 * rather than fabricating output. Tests inject {@link FakeAIProvider} directly.
 */
export function getAIProvider(): AIProvider {
  return new OpenAIProvider();
}

/** Whether live AI execution is available (OpenAI configured). */
export function isAIAvailable(): boolean {
  return isOpenAIConfigured();
}
