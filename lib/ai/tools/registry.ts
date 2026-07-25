import type { Tool, ToolContext, ToolDefinition, ToolInvocation, ToolResult } from './tool';

/**
 * A registry of tools. Provides capability discovery ({@link list}) and a single
 * validated, workspace-scoped invocation path ({@link invoke}) — input is
 * validated against the tool's schema before execution, and a thrown tool error
 * becomes a safe {@link ToolResult} rather than propagating.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown, unknown>>();

  register<I, O>(tool: Tool<I, O>): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool "${tool.definition.name}" is already registered.`);
    }
    this.tools.set(tool.definition.name, tool as Tool<unknown, unknown>);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Capability discovery — the definitions available to plan with. */
  list(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  /**
   * Invoke a tool. Untrusted `invocation.input` is validated against the tool's
   * schema; unknown tools and validation failures return a safe error result.
   */
  async invoke(invocation: ToolInvocation, ctx: ToolContext): Promise<ToolResult<unknown>> {
    const tool = this.tools.get(invocation.tool);
    if (!tool) {
      return {
        ok: false,
        error: { code: 'unknown_tool', message: `Unknown tool "${invocation.tool}".` },
      };
    }
    const parsed = tool.definition.inputSchema.safeParse(invocation.input);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: parsed.error.issues[0]?.message ?? 'Invalid tool input.',
        },
      };
    }
    try {
      return await tool.execute(parsed.data, ctx);
    } catch {
      // Never surface internals from a tool bug.
      return { ok: false, error: { code: 'tool_failed', message: 'The tool failed to run.' } };
    }
  }
}

/** The shared tool registry, seeded with the internal demonstration tools. */
export const toolRegistry = new ToolRegistry();
