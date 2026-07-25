/**
 * Token & cost accounting — reusable models for measuring an AI execution.
 *
 * Development mode estimates values honestly when a provider does not return
 * exact usage: `estimated: true` marks any figure that is an approximation, so
 * the UI and logs never present a guess as a measured value.
 */

/** Tokens consumed by one model call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** True when the counts are approximated rather than reported by the provider. */
  estimated: boolean;
}

/** A monetary cost estimate for one model call. */
export interface CostEstimate {
  currency: 'USD';
  /** Cost in whole USD (not cents). */
  amount: number;
  estimated: boolean;
}

/** Per-1K-token price table (USD). Approximate; used only for dev estimates. */
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'fake-model': { input: 0, output: 0 },
};

const DEFAULT_RATE = { input: 0.0025, output: 0.01 };

/**
 * Rough token estimate (~4 chars/token). Honest approximation for dev; the
 * OpenAI provider supplies exact counts when available.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Build a {@link TokenUsage} from raw text when the provider gives no usage. */
export function estimateUsage(inputText: string, outputText: string): TokenUsage {
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimated: true };
}

/** Estimate the USD cost of a usage against a model's rate. */
export function estimateCost(model: string, usage: TokenUsage): CostEstimate {
  const rate = MODEL_RATES[model] ?? DEFAULT_RATE;
  const amount =
    (usage.inputTokens / 1000) * rate.input + (usage.outputTokens / 1000) * rate.output;
  // Round to 6 dp to avoid floating-point noise in logs.
  return { currency: 'USD', amount: Math.round(amount * 1e6) / 1e6, estimated: true };
}
