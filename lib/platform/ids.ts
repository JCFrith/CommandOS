/**
 * Identifier generation for the platform runtime.
 *
 * A single, dependency-free source of ids so every runtime (AI, and future
 * Workflow / Notification / Integration runtimes) mints ids the same way. The
 * semantic aliases document intent at call sites and are deliberately thin over
 * one generator, so the scheme can change in one place (e.g. to ULIDs) without
 * touching callers. Additional aliases (job / execution ids) are added by the
 * runtimes that consume them, so this surface stays to what is actually used.
 */

/** A fresh, globally-unique id. */
export function newId(): string {
  return crypto.randomUUID();
}

/** A new correlation id — the head of a new causal chain. */
export const newCorrelationId = newId;
