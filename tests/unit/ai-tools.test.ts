import { describe, expect, it } from 'vitest';

import { ToolRegistry } from '@/lib/ai/tools/registry';
import { calculatorTool, echoTool, workspaceInfoTool } from '@/lib/ai/tools/builtin';
import type { ToolContext } from '@/lib/ai/tools/tool';

const ctx: ToolContext = { workspaceId: 'ws-1', operatorId: 'u-1' };

function registry() {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  reg.register(calculatorTool);
  reg.register(workspaceInfoTool);
  return reg;
}

describe('tool registry', () => {
  it('discovers registered tool definitions', () => {
    const names = registry()
      .list()
      .map((d) => d.name)
      .sort();
    expect(names).toEqual(['calculator', 'echo', 'workspace_info']);
  });

  it('validates input against the tool schema before invoking', async () => {
    const reg = registry();
    const bad = await reg.invoke({ tool: 'calculator', input: { a: 'x', b: 2, op: 'add' } }, ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid_input');
  });

  it('returns a safe error for an unknown tool', async () => {
    const res = await registry().invoke({ tool: 'nope', input: {} }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('unknown_tool');
  });

  it('runs the demo tools deterministically', async () => {
    const reg = registry();
    const echo = await reg.invoke({ tool: 'echo', input: { text: 'hi' } }, ctx);
    expect(echo).toEqual({ ok: true, output: { text: 'hi' } });

    const sum = await reg.invoke({ tool: 'calculator', input: { a: 2, b: 3, op: 'add' } }, ctx);
    expect(sum).toEqual({ ok: true, output: { result: 5 } });

    const div0 = await reg.invoke({ tool: 'calculator', input: { a: 1, b: 0, op: 'divide' } }, ctx);
    expect(div0.ok).toBe(false);
  });

  it('scopes a tool to its workspace context', async () => {
    const res = await registry().invoke({ tool: 'workspace_info', input: {} }, ctx);
    expect(res).toEqual({ ok: true, output: { workspaceId: 'ws-1' } });
  });

  it('rejects a duplicate registration', () => {
    const reg = registry();
    expect(() => reg.register(echoTool)).toThrow();
  });
});
