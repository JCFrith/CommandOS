/**
 * Conversation primitives.
 *
 * The types make the trust boundary structural: a {@link SystemPrompt} is
 * created only from trusted, server-owned text; {@link UserInput} wraps
 * untrusted operator content. `Conversation.create` puts the system prompt in
 * the single system message and everything else as user/assistant/tool turns —
 * user content can never become a system instruction.
 */

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
}

/** Trusted, server-defined instruction. The only source of a `system` message. */
export interface SystemPrompt {
  readonly trusted: true;
  text: string;
  /** Prompt-template version, recorded on executions for auditability. */
  version: string;
}

/** Untrusted operator-provided content. Never a system message. */
export interface UserInput {
  readonly trusted: false;
  content: string;
}

/** Wrap trusted text as a system prompt. */
export function systemPrompt(text: string, version: string): SystemPrompt {
  return { trusted: true, text, version };
}

/** Wrap untrusted operator text as user input. */
export function userInput(content: string): UserInput {
  return { trusted: false, content };
}

/**
 * A bounded view over a message list. `fit` keeps the system message plus the
 * most recent turns whose estimated size stays under the budget — the seam a
 * future long conversation uses to stay within a model's context window.
 */
export interface ContextWindow {
  maxTokens: number;
  fit(messages: Message[], estimate: (text: string) => number): Message[];
}

export function contextWindow(maxTokens: number): ContextWindow {
  return {
    maxTokens,
    fit(messages, estimate) {
      const system = messages.filter((m) => m.role === 'system');
      const rest = messages.filter((m) => m.role !== 'system');
      let budget = maxTokens - system.reduce((n, m) => n + estimate(m.content), 0);
      const kept: Message[] = [];
      // Keep newest-first until the budget is exhausted, then restore order.
      for (let i = rest.length - 1; i >= 0; i--) {
        const cost = estimate(rest[i]!.content);
        if (budget - cost < 0) break;
        budget -= cost;
        kept.unshift(rest[i]!);
      }
      return [...system, ...kept];
    },
  };
}

/** A conversation: one trusted system prompt + ordered turns. */
export interface Conversation {
  readonly system: SystemPrompt;
  readonly messages: Message[];
  /** Return a new conversation with an appended turn (immutable). */
  append(role: Exclude<MessageRole, 'system'>, content: string): Conversation;
  /** Materialize provider-ready messages (system first). */
  toMessages(window?: ContextWindow, estimate?: (text: string) => number): Message[];
}

class ConversationImpl implements Conversation {
  constructor(
    readonly system: SystemPrompt,
    readonly messages: Message[],
  ) {}

  append(role: Exclude<MessageRole, 'system'>, content: string): Conversation {
    return new ConversationImpl(this.system, [...this.messages, { role, content }]);
  }

  toMessages(window?: ContextWindow, estimate?: (text: string) => number): Message[] {
    const all: Message[] = [{ role: 'system', content: this.system.text }, ...this.messages];
    if (window && estimate) return window.fit(all, estimate);
    return all;
  }
}

/**
 * Create a conversation from a trusted system prompt and untrusted user input.
 * Additional context (also untrusted) is added as user turns, never system.
 */
export function createConversation(system: SystemPrompt, input: UserInput): Conversation {
  return new ConversationImpl(system, [{ role: 'user', content: input.content }]);
}
