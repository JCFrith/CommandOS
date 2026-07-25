import { NextResponse, type NextRequest } from 'next/server';

import { getOperationsContext } from '@/services/operations/context';
import { operationsService } from '@/services/operations/operations-service';

/**
 * Workspace-scoped operations feed for the ⌘K palette (find / open). The active
 * workspace id is taken from the `workspaceId` query param and honored ONLY if
 * the caller is a member of it (the context returns `null` otherwise), so a
 * client can never read another workspace's operations. Auth + scoping are
 * resolved server-side; the client never talks to a repository or Supabase.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const ctx = await getOperationsContext(workspaceId);
  if (!ctx) return NextResponse.json({ operations: [] });

  const operations = await operationsService.list(ctx);
  return NextResponse.json({
    workspaceId: ctx.workspace.id,
    operations: operations.map((op) => ({ id: op.id, title: op.title, status: op.status })),
  });
}
