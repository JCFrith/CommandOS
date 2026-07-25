import { NextResponse, type NextRequest } from 'next/server';

import { getWorkspaceContext } from '@/services/workspace/context';
import { agentService } from '@/services/agents';
import { canExecuteAgent } from '@/lib/agents/permissions';

/**
 * Workspace-scoped agents feed for the ⌘K palette (find / open / run). Same
 * scoping guarantees as the operations feed: the `workspaceId` param is honored
 * only for a workspace the caller belongs to. `runnable` reflects execute
 * permission + active status so the palette can offer a "Run" action honestly.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const ctx = await getWorkspaceContext(workspaceId);
  if (!ctx) return NextResponse.json({ agents: [] });

  const agents = await agentService.list(ctx);
  return NextResponse.json({
    workspaceId: ctx.workspace.id,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
      runnable: canExecuteAgent(ctx.user, ctx.workspace, a),
    })),
  });
}
