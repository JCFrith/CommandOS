import { describe, expect, it } from 'vitest';

import {
  contextWindow,
  createConversation,
  systemPrompt,
  userInput,
} from '@/lib/ai/conversation/conversation';
import { estimateTokens } from '@/lib/ai/runtime/accounting';

describe('conversation model (trust boundary)', () => {
  it('places the trusted system prompt first and user input as a user turn', () => {
    const convo = createConversation(
      systemPrompt('You are trusted.', 'v1'),
      userInput('do a thing'),
    );
    const messages = convo.toMessages();
    expect(messages[0]).toEqual({ role: 'system', content: 'You are trusted.' });
    expect(messages[1]).toEqual({ role: 'user', content: 'do a thing' });
    // The only system message is the trusted one — user content never becomes system.
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  it('marks system prompts trusted and user input untrusted, structurally', () => {
    expect(systemPrompt('x', 'v1').trusted).toBe(true);
    expect(userInput('x').trusted).toBe(false);
  });

  it('appends turns immutably', () => {
    const a = createConversation(systemPrompt('s', 'v1'), userInput('one'));
    const b = a.append('assistant', 'reply');
    expect(a.messages).toHaveLength(1);
    expect(b.messages).toHaveLength(2);
    expect(b.messages[1]).toEqual({ role: 'assistant', content: 'reply' });
  });

  it('fits messages within a context window, keeping system + newest turns', () => {
    let convo = createConversation(systemPrompt('sys', 'v1'), userInput('oldest'));
    convo = convo.append('assistant', 'middle').append('user', 'newest');
    const window = contextWindow(estimateTokens('sys') + estimateTokens('newest') + 1);
    const fitted = convo.toMessages(window, estimateTokens);
    expect(fitted[0]?.role).toBe('system');
    expect(fitted.some((m) => m.content === 'newest')).toBe(true);
    expect(fitted.some((m) => m.content === 'oldest')).toBe(false);
  });
});
