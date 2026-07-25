'use client';

import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Error boundary for the agents surfaces. Next.js logs the underlying error (and
 * passes only a digest in production), so this stays a clean recovery UI and
 * never renders sensitive details.
 */
export default function AgentsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="border-destructive/40 bg-destructive/5 mx-auto flex w-full max-w-5xl flex-col items-center rounded-2xl border border-dashed p-12 text-center">
      <span className="bg-destructive/10 text-destructive ring-destructive/20 grid size-12 place-items-center rounded-xl ring-1">
        <TriangleAlert className="size-6" />
      </span>
      <h2 className="mt-4 text-sm font-semibold">Something went wrong loading agents</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        The agents surface hit an unexpected error. Try again — if it persists, check the server
        logs.
      </p>
      <Button onClick={reset} variant="outline" className="mt-5">
        Try again
      </Button>
    </div>
  );
}
