'use client';

import { useState, useTransition } from 'react';
import { Play, Loader2, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AgentExecutionResultView } from './agent-execution-result';
import { runAgentAction } from '@/app/console/agents/actions';
import type { AgentExecution } from '@/types';

type Availability = 'ready' | 'unavailable' | 'not-executable' | 'forbidden';

/**
 * The agent execution interface. Present only when the operator can run the
 * agent; otherwise it renders an honest disabled/unavailable notice. Submits the
 * operator's request to the run action (which invokes the AI through the
 * provider boundary) and shows the resulting completed/failed execution inline —
 * never a fabricated success. Double-submission is prevented while pending.
 */
export function AgentRunner({
  agentId,
  availability,
}: {
  agentId: string;
  availability: Availability;
}) {
  const [pending, startTransition] = useTransition();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [execution, setExecution] = useState<AgentExecution | null>(null);

  if (availability !== 'ready') {
    return <RunnerNotice availability={availability} />;
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || input.trim().length === 0) return;
    setError(null);
    setExecution(null);
    startTransition(async () => {
      const result = await runAgentAction(agentId, input);
      if (result.error) setError(result.error);
      else setExecution(result.execution);
    });
  };

  const canSubmit = !pending && input.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="run-input">Request</Label>
          <Textarea
            id="run-input"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={4000}
            placeholder="Describe what you want this agent to do…"
            aria-describedby="run-hint"
          />
          <p id="run-hint" className="text-muted-foreground text-xs">
            Your request is sent as context to the model. Don’t include secrets.
          </p>
        </div>
        <div>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {pending ? 'Running…' : 'Run agent'}
          </Button>
        </div>
      </form>

      {error && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      {execution?.status === 'failed' && execution.error && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {execution.error}
        </p>
      )}

      {execution?.status === 'completed' && execution.result && (
        <div
          role="status"
          className="border-border/60 bg-card/40 rounded-2xl border p-4 backdrop-blur"
        >
          <AgentExecutionResultView result={execution.result} />
          {execution.model && (
            <p className="text-muted-foreground mt-3 text-[11px]">
              {execution.model}
              {execution.durationMs != null && ` · ${execution.durationMs}ms`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RunnerNotice({ availability }: { availability: Exclude<Availability, 'ready'> }) {
  const copy: Record<Exclude<Availability, 'ready'>, string> = {
    unavailable:
      'AI execution is unavailable — no model provider is configured. Set OpenAI credentials to run agents.',
    'not-executable': 'This agent must be Active to run. Activate it from the lifecycle controls.',
    forbidden: 'You don’t have permission to run this agent.',
  };
  return (
    <div className="border-border/60 bg-muted/20 text-muted-foreground flex items-start gap-2 rounded-2xl border border-dashed p-4 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{copy[availability]}</p>
    </div>
  );
}
