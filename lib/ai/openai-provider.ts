import 'server-only';

import { isOpenAIConfigured, openAIConfig } from '@/lib/env';
import { getOpenAI } from '@/lib/openai/client';
import { executionResultSchema, EXECUTION_RESULT_JSON_SCHEMA } from '@/lib/ai/result-schema';
import {
  AIProviderError,
  type AIInvocation,
  type AIProvider,
  type AIResult,
} from '@/lib/ai/provider';

/** Hard ceiling on a single model call. */
const TIMEOUT_MS = 30_000;

/**
 * OpenAI-backed {@link AIProvider}. Server-only. Centralizes model selection
 * (from {@link openAIConfig} — never the client), enforces a timeout, requests a
 * strict structured output, and maps every failure to a SAFE
 * {@link AIProviderError} — no secrets, prompts, stack traces, or raw provider
 * responses ever leave this module.
 */
export class OpenAIProvider implements AIProvider {
  isAvailable(): boolean {
    return isOpenAIConfigured();
  }

  async run(invocation: AIInvocation): Promise<AIResult> {
    if (!this.isAvailable()) {
      throw new AIProviderError('unavailable', 'CMD-AI-001', 'AI is not configured.');
    }
    const { model } = openAIConfig();
    const client = getOpenAI();
    const startedAt = performance.now();

    let raw: string | null;
    try {
      const completion = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: invocation.system },
            { role: 'user', content: invocation.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'agent_execution_result',
              strict: true,
              schema: EXECUTION_RESULT_JSON_SCHEMA,
            },
          },
        },
        { timeout: TIMEOUT_MS, maxRetries: 1 },
      );
      raw = completion.choices[0]?.message?.content ?? null;
    } catch (error) {
      // Never surface provider internals. Distinguish timeout for a retryable UX.
      const isTimeout =
        error instanceof Error &&
        (error.name === 'APIConnectionTimeoutError' || /timeout|aborted/i.test(error.message));
      if (isTimeout) {
        throw new AIProviderError(
          'timeout',
          'CMD-AI-003',
          'The AI assistant took too long to respond. Please try again.',
        );
      }
      throw new AIProviderError(
        'failed',
        'CMD-AI-002',
        'The AI assistant could not complete this request. Please try again.',
      );
    }

    if (!raw) {
      throw new AIProviderError(
        'invalid_output',
        'CMD-AI-004',
        'The AI returned an empty response.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AIProviderError(
        'invalid_output',
        'CMD-AI-004',
        'The AI returned a response in an unexpected format.',
      );
    }

    const result = executionResultSchema.safeParse(parsed);
    if (!result.success) {
      throw new AIProviderError(
        'invalid_output',
        'CMD-AI-004',
        'The AI returned a response in an unexpected format.',
      );
    }

    return {
      output: result.data,
      model,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}
