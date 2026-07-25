import type { AgentExecutionResult } from '@/types';
import { executionResultSchema } from '@/lib/ai/result-schema';
import {
  AIProviderError,
  type AIInvocation,
  type AIProvider,
  type AIResult,
} from '@/lib/ai/provider';

export type FakeMode = 'success' | 'timeout' | 'failed' | 'invalid_output' | 'unavailable';

/**
 * DETERMINISTIC {@link AIProvider} for tests and local development — it never
 * calls a live model. Given the same invocation it returns the same result, so
 * unit/integration tests are stable and offline. It is NOT wired into the
 * production provider factory; a real run with no OpenAI key surfaces an honest
 * "unavailable" state rather than this fake output.
 */
export class FakeAIProvider implements AIProvider {
  constructor(
    private readonly mode: FakeMode = 'success',
    private readonly available = true,
  ) {}

  isAvailable(): boolean {
    return this.available;
  }

  async run(invocation: AIInvocation): Promise<AIResult> {
    switch (this.mode) {
      case 'unavailable':
        throw new AIProviderError('unavailable', 'CMD-AI-001', 'AI is not configured.');
      case 'timeout':
        throw new AIProviderError(
          'timeout',
          'CMD-AI-003',
          'The AI assistant took too long to respond. Please try again.',
        );
      case 'failed':
        throw new AIProviderError(
          'failed',
          'CMD-AI-002',
          'The AI assistant could not complete this request. Please try again.',
        );
      case 'invalid_output':
        throw new AIProviderError(
          'invalid_output',
          'CMD-AI-004',
          'The AI returned a response in an unexpected format.',
        );
      case 'success':
      default: {
        const output: AgentExecutionResult = executionResultSchema.parse({
          summary: `Reviewed the request (${invocation.user.length} chars of context) and prepared guidance.`,
          keyPoints: ['Context received', 'Analysis complete'],
          risks: ['This is deterministic development output, not a real model response.'],
          recommendations: ['Configure OpenAI credentials to run against a live model.'],
          confidence: 'medium',
        });
        return { output, model: 'fake-model', durationMs: 1 };
      }
    }
  }
}
