import { NextResponse, type NextRequest } from 'next/server';

import { getWorkspaceContext } from '@/services/workspace/context';
import { workflowService } from '@/services/workflows';

/**
 * Workspace-scoped workflows feed for the ⌘K palette (find / open). The active
 * workspace id is taken from `workspaceId` and honored ONLY if the caller is a
 * member of it, so a client can never read another workspace's workflows.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const ctx = await getWorkspaceContext(workspaceId);
  if (!ctx) return NextResponse.json({ workflows: [] });

  const workflows = await workflowService.list(ctx);
  return NextResponse.json({
    workspaceId: ctx.workspace.id,
    workflows: workflows.map((w) => ({ id: w.id, name: w.name, status: w.status })),
  });
}
