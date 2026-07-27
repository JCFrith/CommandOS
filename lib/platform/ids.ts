/**
 * Identifier generation for the platform runtime.
 *
 * A single, dependency-free source of ids so every runtime (AI, and future
 * Workflow / Notification / Integration runtimes) mints execution, correlation,
 * and job ids the same way. The semantic aliases document intent at call sites;
 * they are deliberately thin over one generator so the scheme can change in one
 * place (e.g. to ULIDs) without touching callers.
 */

/** A fresh, globally-unique id. */
export function newId(): string {
  return crypto.randomUUID();
}

/** A new execution id. */
export const newExecutionId = newId;

/** A new correlation id — the head of a new causal chain. */
export const newCorrelationId = newId;

/** A new background-job id. */
export const newJobId = newId;
