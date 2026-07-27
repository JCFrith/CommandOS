/**
 * The AI execution runtime — public surface.
 *
 * AI-specific concepts (the execution request/result/metadata, accounting,
 * logging, and the `ExecutionRuntime` itself) live here. The reusable runtime
 * primitives it builds on — retry, cancellation, the execution status machine,
 * correlation, ids, and the background contracts — are owned by the platform
 * runtime (`@/lib/platform`) and re-exported here for convenience, so a consumer
 * can pull an AI-adjacent primitive from one place while the source of truth
 * stays in the platform layer.
 */

export * from './execution';
export * from './accounting';
export * from './logging';
export { ExecutionRuntime, type RuntimeDeps } from './runtime';

// Re-exported from the platform runtime (source of truth: @/lib/platform).
export {
  runWithRetry,
  NO_RETRY,
  fixedRetry,
  exponentialRetry,
  delayForAttempt,
  type RetryPolicy,
  type RetryKind,
  type RunWithRetryOptions,
  createCancellation,
  type CancellationToken,
  type CancellationSource,
} from '@/lib/platform';
