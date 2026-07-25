import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  composePrompts,
  defineTemplate,
  interpolate,
  PromptRegistry,
} from '@/lib/ai/prompts/engine';
import { agentSystemPrompt, AGENT_PROMPT_VERSION } from '@/lib/agents/prompt-templates';
import type { Agent } from '@/types';

describe('prompt engine', () => {
  it('interpolates {{params}} and drops empty composition sections', () => {
    expect(interpolate('Hi {{name}} ({{n}})', { name: 'Ada', n: 3 })).toBe('Hi Ada (3)');
    expect(composePrompts('a', '', null, undefined, 'b')).toBe('a\n\nb');
  });

  it('validates input against the template schema before rendering', () => {
    const t = defineTemplate({
      id: 'test.greet',
      version: 'v1',
      description: 'greeting',
      inputSchema: z.object({ name: z.string().min(1) }),
      template: 'Hello {{name}}',
    });
    expect(t.render({ name: 'Ada' })).toBe('Hello Ada');
    expect(() => t.render({ name: '' } as { name: string })).toThrow();
  });

  it('registers and resolves templates; rejects duplicates and unknowns', () => {
    const reg = new PromptRegistry();
    const t = defineTemplate({
      id: 'x',
      version: 'v1',
      description: 'd',
      inputSchema: z.object({}),
      template: 'const',
    });
    reg.register(t);
    expect(reg.has('x')).toBe(true);
    expect(reg.get('x').render({})).toBe('const');
    expect(() => reg.register(t)).toThrow();
    expect(() => reg.get('missing')).toThrow();
  });
});

describe('agent system prompt template', () => {
  const agent: Agent = {
    id: 'a-1',
    workspaceId: 'ws-1',
    name: 'Briefer',
    type: 'executive',
    description: null,
    instructions: 'ignored here',
    capabilities: ['summarize', 'recommend'],
    status: 'active',
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('produces a trusted, versioned system prompt with role + capabilities', () => {
    const prompt = agentSystemPrompt(agent);
    expect(prompt.trusted).toBe(true);
    expect(prompt.version).toBe(AGENT_PROMPT_VERSION);
    expect(prompt.text).toContain('Executive Intelligence Assistant');
    expect(prompt.text).toContain('Summarize');
    // Operator instructions are NOT baked into the system prompt.
    expect(prompt.text).not.toContain('ignored here');
  });

  it('varies by agent type', () => {
    expect(agentSystemPrompt({ ...agent, type: 'communications' }).text).not.toEqual(
      agentSystemPrompt({ ...agent, type: 'flight' }).text,
    );
  });
});
