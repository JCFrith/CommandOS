'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createWorkflowAction } from '@/app/console/workflows/actions';
import { STARTER_DEFINITION_JSON } from '@/lib/workflows/starter';

/**
 * Create a workflow: name + description + a JSON graph definition (prefilled with
 * a valid starter template). The definition is validated server-side on publish;
 * a visual graph editor is future work.
 */
export function WorkflowForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [definition, setDefinition] = useState(STARTER_DEFINITION_JSON);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createWorkflowAction({ name, description, definition });
      if (result?.error) setError(result.error);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wf-name">Name</Label>
        <Input
          id="wf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekly ops review"
          required
          maxLength={120}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wf-desc">Description</Label>
        <Textarea
          id="wf-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this workflow automates"
          rows={2}
          maxLength={2000}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wf-def">Definition (JSON)</Label>
        <Textarea
          id="wf-def"
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
          rows={16}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">
          The graph is validated on publish. Edit the starter template to author your own workflow.
        </p>
      </div>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? 'Creating…' : 'Create workflow'}
        </Button>
      </div>
    </form>
  );
}
