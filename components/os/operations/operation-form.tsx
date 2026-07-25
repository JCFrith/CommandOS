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
import { cn } from '@/lib/utils';
import { PRIORITY_META } from '@/lib/operations/display';
import { createOperationSchema, type CreateOperationInput } from '@/lib/operations/schema';
import { createOperationAction, updateOperationAction } from '@/app/console/operations/actions';
import type { OperationPriority } from '@/types';

const PRIORITIES: OperationPriority[] = ['low', 'medium', 'high'];

/**
 * Create/edit form for an Operation. Client-side validation is owned by React
 * Hook Form + Zod; submission calls the server action, which re-validates with
 * the authoritative service schema and owns the redirect on success. Only an
 * error returns here.
 */
export function OperationForm({
  mode,
  operationId,
  initial,
  cancelHref,
}: {
  mode: 'create' | 'edit';
  operationId?: string;
  initial?: { title: string; description: string; priority: OperationPriority };
  cancelHref: string;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CreateOperationInput>({
    resolver: zodResolver(createOperationSchema),
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      priority: initial?.priority ?? 'medium',
    },
    mode: 'onBlur',
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    const input = {
      title: values.title,
      description: values.description ?? '',
      priority: values.priority,
    };
    const result =
      mode === 'create'
        ? await createOperationAction(input)
        : await updateOperationAction(operationId ?? '', input);
    // Success redirects server-side; only an error state returns here.
    if (result?.error) setServerError(result.error);
  });

  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          autoFocus
          placeholder="Ship the Q3 operations review"
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? 'title-error' : undefined}
          {...form.register('title')}
        />
        {errors.title && (
          <p id="title-error" className="text-destructive text-xs">
            {errors.title.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          rows={4}
          placeholder="What is this operation, and what does done look like?"
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
        <Label htmlFor="priority">Priority</Label>
        <select
          id="priority"
          className={cn(
            'border-input bg-background/40 focus-visible:border-ring focus-visible:ring-ring/40 h-10 rounded-lg border px-3 text-sm shadow-sm outline-none focus-visible:ring-[3px]',
          )}
          {...form.register('priority')}
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_META[priority].label}
            </option>
          ))}
        </select>
      </div>

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
          {mode === 'create' ? 'Create operation' : 'Save changes'}
        </Button>
        <Button asChild variant="ghost" type="button">
          <Link href={cancelHref as Route}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
