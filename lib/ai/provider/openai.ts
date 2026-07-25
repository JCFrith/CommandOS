import 'server-only';

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { isOpenAIConfigured, openAIConfig } from '@/lib/env';
import { getOpenAI } from '@/lib/openai/client';
import { estimateUsage, type TokenUsage } from '@/lib/ai/runtime/accounting';
import {
  ProviderError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ProviderCapabilities,
} from './provider';

/** Default hard ceiling on a single model call. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * OpenAI-backed {@link ModelProvider}. Server-only. Model selection comes from
 * {@link openAIConfig} (env) — never the request. Every failure is mapped to a
 * SAFE {@link ProviderError}; no secrets, prompts, or raw payloads escape.
 */
export class OpenAIModelProvider implements ModelProvider {
  readonly id = 'openai';

  isAvailable(): boolean {
    return isOpenAIConfigured();
  }

  capabilities(): ProviderCapabilities {
    return { structuredOutput: true, streaming: false, toolCalls: false };
  }

  async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    if (!this.isAvailable()) {
      throw new ProviderError('unavailable', 'CMD-AI-001', 'AI is not configured.');
    }
    const { model } = openAIConfig();
    const client = getOpenAI();

    try {
      const completion = await client.chat.completions.create(
        {
          model,
          // Our conversation only emits system/user/assistant turns; the shared
          // `Message` type also allows `tool` (for future tool-calling), so map
          // to the SDK param type explicitly.
          messages: request.messages as ChatCompletionMessageParam[],
          ...(request.structuredOutput
            ? {
                response_format: {
                  type: 'json_schema' as const,
                  json_schema: {
                    name: request.structuredOutput.name,
                    strict: true,
                    schema: request.structuredOutput.schema,
                  },
                },
              }
            : {}),
        },
        { timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: 0, signal },
      );

      const content = completion.choices[0]?.message?.content ?? '';
      const finishReason = completion.choices[0]?.finish_reason === 'length' ? 'length' : 'stop';
      const usage = toUsage(completion.usage, request, content);
      return { content, model, usage, finishReason };
    } catch (error) {
      throw mapError(error);
    }
  }
}

function toUsage(
  raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined,
  request: ModelRequest,
  content: string,
): TokenUsage {
  if (raw && typeof raw.prompt_tokens === 'number' && typeof raw.completion_tokens === 'number') {
    return {
      inputTokens: raw.prompt_tokens,
      outputTokens: raw.completion_tokens,
      totalTokens: raw.total_tokens ?? raw.prompt_tokens + raw.completion_tokens,
      estimated: false,
    };
  }
  // Fall back to an honest estimate when the provider omits usage.
  return estimateUsage(request.messages.map((m) => m.content).join('\n'), content);
}

function mapError(error: unknown): ProviderError {
  const isTimeout =
    error instanceof Error &&
    (error.name === 'APIConnectionTimeoutError' ||
      error.name === 'AbortError' ||
      /timeout|aborted/i.test(error.message));
  if (isTimeout) {
    return new ProviderError(
      'timeout',
      'CMD-AI-003',
      'The AI assistant took too long to respond. Please try again.',
      true,
    );
  }
  return new ProviderError(
    'failed',
    'CMD-AI-002',
    'The AI assistant could not complete this request. Please try again.',
    true,
  );
}
