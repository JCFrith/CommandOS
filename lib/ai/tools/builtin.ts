import { z } from 'zod';

import { toolOk, type Tool } from './tool';
import { toolRegistry } from './registry';

/**
 * Internal demonstration tools. Deterministic, pure, side-effect-free — they
 * exist to prove the tool framework end-to-end (definition → validation →
 * scoped invocation → result), NOT to ship capabilities. Real tools (and
 * MCP-backed tools) register the same way.
 */

/** Echo — returns the provided text. The simplest possible tool. */
export const echoTool: Tool<{ text: string }, { text: string }> = {
  definition: {
    name: 'echo',
    description: 'Return the provided text unchanged.',
    inputSchema: z.object({ text: z.string().max(1000) }),
  },
  async execute(input) {
    return toolOk({ text: input.text });
  },
};

/** Calculator — safe two-operand arithmetic (no eval). */
export const calculatorTool: Tool<
  { a: number; b: number; op: 'add' | 'subtract' | 'multiply' | 'divide' },
  { result: number }
> = {
  definition: {
    name: 'calculator',
    description: 'Compute a two-operand arithmetic expression.',
    inputSchema: z.object({
      a: z.number().finite(),
      b: z.number().finite(),
      op: z.enum(['add', 'subtract', 'multiply', 'divide']),
    }),
  },
  async execute({ a, b, op }) {
    switch (op) {
      case 'add':
        return toolOk({ result: a + b });
      case 'subtract':
        return toolOk({ result: a - b });
      case 'multiply':
        return toolOk({ result: a * b });
      case 'divide':
        if (b === 0)
          return {
            ok: false,
            error: { code: 'divide_by_zero', message: 'Cannot divide by zero.' },
          };
        return toolOk({ result: a / b });
    }
  },
};

/** Workspace info — echoes the caller's scope (demonstrates ToolContext). */
export const workspaceInfoTool: Tool<Record<string, never>, { workspaceId: string }> = {
  definition: {
    name: 'workspace_info',
    description: 'Return the id of the workspace the tool is running in.',
    inputSchema: z.object({}),
  },
  async execute(_input, ctx) {
    return toolOk({ workspaceId: ctx.workspaceId });
  },
};

/** Register the demo tools on the shared registry (idempotent import). */
export function registerBuiltinTools(): void {
  if (!toolRegistry.has(echoTool.definition.name)) toolRegistry.register(echoTool);
  if (!toolRegistry.has(calculatorTool.definition.name)) toolRegistry.register(calculatorTool);
  if (!toolRegistry.has(workspaceInfoTool.definition.name))
    toolRegistry.register(workspaceInfoTool);
}

registerBuiltinTools();
