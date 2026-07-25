import { NextResponse } from 'next/server';

import { getOperationsContext } from '@/services/operations/context';
import { operationsService } from '@/services/operations/operations-service';

/**
 * Workspace-scoped operations feed for the ⌘K palette (find / open). Auth and
 * scoping are resolved server-side via the operations context; the client only
 * ever talks to this route, never to a repository or Supabase directly.
 */
export async function GET() {
  const ctx = await getOperationsContext();
  if (!ctx) return NextResponse.json({ operations: [] });

  const operations = await operationsService.list(ctx);
  return NextResponse.json({
    operations: operations.map((op) => ({
      id: op.id,
      title: op.title,
      status: op.status,
    })),
  });
}
