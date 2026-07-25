import type { z } from 'zod';

/**
 * The reusable tool architecture. Enough infrastructure for future tools (and
 * MCP-backed tools) to plug in without architectural change; only a few internal
 * demonstration tools are implemented in this sprint.
 */

/** Execution context handed to a tool — ids + cancellation only, no secrets. */
export interface ToolContext {
  workspaceId: string;
  operatorId: string;
  signal?: AbortSignal;
}

/** Discoverable metadata + input contract for a tool. */
export interface ToolDefinition<I = unknown> {
  name: string;
  description: string;
  /** Validates and types the tool input. */
  inputSchema: z.ZodType<I>;
}

/** A safe tool failure. `message` never contains secrets or internals. */
export interface ToolError {
  code: string;
  message: string;
}

export type ToolResult<O> = { ok: true; output: O } | { ok: false; error: ToolError };

/** A tool: a validated, workspace-scoped capability the runtime can invoke. */
export interface Tool<I, O> {
  definition: ToolDefinition<I>;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}

/** A request to invoke a tool by name with (untrusted) input. */
export interface ToolInvocation {
  tool: string;
  input: unknown;
}

/** Helper to build a success result. */
export function toolOk<O>(output: O): ToolResult<O> {
  return { ok: true, output };
}

/** Helper to build a failure result. */
export function toolError(code: string, message: string): ToolResult<never> {
  return { ok: false, error: { code, message } };
}
