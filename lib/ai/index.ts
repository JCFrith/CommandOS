/**
 * `lib/ai` barrel — the AI platform surface. The execution runtime, provider
 * abstraction, conversation model, prompt engine, and tool framework live in
 * their own subdirectories (`runtime`, `provider`, `conversation`, `prompts`,
 * `tools`); import those directly for platform work. This barrel keeps the small
 * app-facing helpers stable.
 */

export {
  getModelProvider,
  isModelAvailable,
  isModelAvailable as isAIAvailable,
} from '@/lib/ai/provider';
