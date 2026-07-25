import type { z } from 'zod';

/**
 * The prompt template engine.
 *
 * Every system prompt in CommandOS is a versioned, strongly-typed template
 * registered here — no prompt strings scattered across the codebase. Inputs are
 * validated with Zod before rendering; templates can be composed from sections.
 */

export interface PromptTemplate<TInput> {
  id: string;
  version: string;
  description: string;
  /** Validates the render input — the typed contract for this prompt. */
  inputSchema: z.ZodType<TInput>;
  /** Produce the prompt text from validated input. */
  render(input: TInput): string;
}

export interface DefineTemplateArgs<TInput> {
  id: string;
  version: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  /** A `{{param}}` template string, or a render function for richer logic. */
  template?: string;
  render?: (input: TInput) => string;
}

/** Substitute `{{key}}` placeholders from a flat record of primitives. */
export function interpolate(
  template: string,
  params: Record<string, string | number | boolean>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? '' : String(value);
  });
}

/** Compose prompt sections into one block, dropping empties. */
export function composePrompts(...sections: (string | null | undefined)[]): string {
  return sections
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    .join('\n\n');
}

/** Define a template. Exactly one of `template` / `render` must be provided. */
export function defineTemplate<TInput>(args: DefineTemplateArgs<TInput>): PromptTemplate<TInput> {
  const { id, version, description, inputSchema, template, render } = args;
  if (!template && !render) {
    throw new Error(`Prompt template "${id}" needs a template string or a render function.`);
  }
  return {
    id,
    version,
    description,
    inputSchema,
    render(input: TInput): string {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Invalid input for prompt "${id}": ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        );
      }
      return render
        ? render(parsed.data)
        : interpolate(template as string, parsed.data as Record<string, string | number | boolean>);
    },
  };
}

/** A registry of prompt templates, keyed by id. */
export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate<unknown>>();

  register<TInput>(template: PromptTemplate<TInput>): void {
    if (this.templates.has(template.id)) {
      throw new Error(`Prompt template "${template.id}" is already registered.`);
    }
    this.templates.set(template.id, template as PromptTemplate<unknown>);
  }

  get<TInput>(id: string): PromptTemplate<TInput> {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Unknown prompt template "${id}".`);
    return template as PromptTemplate<TInput>;
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  list(): { id: string; version: string; description: string }[] {
    return [...this.templates.values()].map(({ id, version, description }) => ({
      id,
      version,
      description,
    }));
  }
}

/** The shared prompt registry. Domain modules register their templates here. */
export const promptRegistry = new PromptRegistry();
