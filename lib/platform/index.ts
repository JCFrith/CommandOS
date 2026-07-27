/**
 * The platform runtime — the reusable, **AI-agnostic** foundation every runtime
 * builds on (AI today; Workflow / Notification / Integration / Background /
 * Scheduling tomorrow).
 *
 * Dependency direction is one-way:
 *
 * ```
 *   Feature ──▶ Platform Runtime ──▶ AI Runtime (optional)
 * ```
 *
 * **Platform must never import AI.** It owns retry, cancellation, execution
 * identifiers, correlation, the generic execution status machine + context +
 * events, and the background/queue/worker/scheduler/job-store contracts. AI
 * concepts (providers, conversations, prompts, tools, token/cost accounting, the
 * `ExecutionRuntime`) stay in `lib/ai` and *consume* this layer.
 */

export * from './ids';
export * from './correlation';
export * from './retry';
export * from './cancellation';
export * from './execution';
export * from './background';
