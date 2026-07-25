import Link from 'next/link';
import { Bot, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Empty state for the agents list — states the intent, offers the action. */
export function AgentsEmptyState() {
  return (
    <div className="border-border/60 bg-card/30 flex flex-col items-center rounded-2xl border border-dashed p-12 text-center backdrop-blur">
      <span className="bg-primary/10 text-primary ring-primary/20 grid size-12 place-items-center rounded-xl ring-1">
        <Bot className="size-6" />
      </span>
      <h2 className="mt-4 text-sm font-semibold">No agents yet</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        Agents are AI collaborators that reason over context you provide and return structured
        guidance. Create your first agent to get started.
      </p>
      <Button asChild className="mt-5">
        <Link href="/console/agents/new">
          <Plus className="size-4" />
          New agent
        </Link>
      </Button>
    </div>
  );
}
