import { isOpenAIConfigured } from '@/lib/env';
import { OpenAIModelProvider } from './openai';
import type { ModelProvider } from './provider';

export type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelConfig,
  ModelStreamChunk,
  StreamingModelProvider,
  ProviderCapabilities,
  StructuredOutputSpec,
  ProviderErrorCode,
} from './provider';
export { ProviderError, supportsStreaming } from './provider';
export { FakeModelProvider, type FakeModelOptions } from './fake';

/**
 * The production model provider — always the real OpenAI adapter, never a silent
 * fake. An unconfigured environment surfaces an honest unavailable state
 * ({@link isModelAvailable}); tests inject {@link FakeModelProvider}.
 */
export function getModelProvider(): ModelProvider {
  return new OpenAIModelProvider();
}

/** Whether live model execution is available (OpenAI configured). */
export function isModelAvailable(): boolean {
  return isOpenAIConfigured();
}
