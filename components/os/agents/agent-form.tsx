'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TYPE_META, CAPABILITY_LABELS } from '@/lib/agents/display';
import {
  AGENT_CAPABILITIES,
  AGENT_TYPES,
  createAgentSchema,
  type CreateAgentInput,
} from '@/lib/agents/schema';
import { createAgentAction, updateAgentAction } from '@/app/console/agents/actions';
import type { AgentType } from '@/types';

/**
 * Create/edit form for an agent. Client validation via RHF + Zod; the server
 * action re-validates with the authoritative schema and owns the redirect. Type
 * is chosen at creation and immutable afterwards (edit hides it).
 */
export function AgentForm({
  mode,
  agentId,
  initial,
  cancelHref,
}: {
  mode: 'create' | 'edit';
  agentId?: string;
  initial?: {
    name: string;
    type: AgentType;
    description: string;
    instructions: string;
    capabilities: string[];
  };
  cancelHref: string;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CreateAgentInput>({
    resolver: zodResolver(createAgentSchema),
    defaultValues: {
      name: initial?.name ?? '',
      type: initial?.type ?? 'executive',
      description: initial?.description ?? '',
      instructions: initial?.instructions ?? '',
      capabilities: (initial?.capabilities as CreateAgentInput['capabilities']) ?? [],
    },
    mode: 'onBlur',
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    const result =
      mode === 'create'
        ? await createAgentAction({
            name: values.name,
            type: values.type,
            description: values.description ?? '',
            instructions: values.instructions ?? '',
            capabilities: values.capabilities,
          })
        : await updateAgentAction(agentId ?? '', {
            name: values.name,
            description: values.description ?? '',
            instructions: values.instructions ?? '',
            capabilities: values.capabilities,
          });
    if (result?.error) setServerError(result.error);
  });

  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          autoFocus
          placeholder="Morning Briefing"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
          {...form.register('name')}
        />
        {errors.name && (
          <p id="name-error" className="text-destructive text-xs">
            {errors.name.message}
          </p>
        )}
      </div>

      {mode === 'create' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            className="border-input bg-background/40 focus-visible:border-ring focus-visible:ring-ring/40 h-10 rounded-lg border px-3 text-sm shadow-sm outline-none focus-visible:ring-[3px]"
            {...form.register('type')}
          >
            {AGENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_META[type].label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            {TYPE_META[form.watch('type')].blurb} Type can’t be changed later.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          placeholder="What is this agent for?"
          aria-invalid={!!errors.description}
          aria-describedby={errors.description ? 'description-error' : undefined}
          {...form.register('description')}
        />
        {errors.description && (
          <p id="description-error" className="text-destructive text-xs">
            {errors.description.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="instructions">Instructions</Label>
        <Textarea
          id="instructions"
          rows={4}
          placeholder="Standing guidance for this agent (treated as context, not commands)."
          aria-invalid={!!errors.instructions}
          aria-describedby={errors.instructions ? 'instructions-error' : 'instructions-hint'}
          {...form.register('instructions')}
        />
        {errors.instructions ? (
          <p id="instructions-error" className="text-destructive text-xs">
            {errors.instructions.message}
          </p>
        ) : (
          <p id="instructions-hint" className="text-muted-foreground text-xs">
            Provided as context to the model — never as privileged instructions.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Capabilities</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AGENT_CAPABILITIES.map((capability) => (
            <label
              key={capability}
              className="border-border/60 bg-card/40 hover:border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
            >
              <input
                type="checkbox"
                value={capability}
                className="accent-primary size-4"
                {...form.register('capabilities')}
              />
              {CAPABILITY_LABELS[capability]}
            </label>
          ))}
        </div>
      </fieldset>

      {serverError && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-xs"
        >
          {serverError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {mode === 'create' ? 'Create agent' : 'Save changes'}
        </Button>
        <Button asChild variant="ghost" type="button">
          <Link href={cancelHref as Route}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
