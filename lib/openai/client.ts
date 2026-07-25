import OpenAI from 'openai';
import { serverEnv } from '@/lib/env';

let cached: OpenAI | null = null;

/**
 * Lazily-constructed OpenAI client. Server-only — never import from a Client
 * Component. The key is validated through {@link serverEnv}.
 */
export function getOpenAI(): OpenAI {
  if (cached) return cached;
  const env = serverEnv();
  cached = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return cached;
}

/** The configured default chat model. */
export function defaultModel(): string {
  return serverEnv().OPENAI_MODEL;
}
