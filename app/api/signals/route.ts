import { NextResponse, type NextRequest } from 'next/server';

import { getWorkspaceContext } from '@/services/workspace/context';
import { signalsService } from '@/services/signals';

/**
 * Workspace-scoped signals feed for the ⌘K palette (open a recent signal). The
 * active workspace id is taken from `workspaceId` and honored ONLY if the caller
 * is a member of it (the context returns `null` otherwise), so a client can
 * never read another workspace's signals. Returns a small recent slice — the
 * feed is for quick navigation, not bulk export. Auth + scoping are resolved
 * server-side; the client never touches the store.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const ctx = await getWorkspaceContext(workspaceId);
  if (!ctx) return NextResponse.json({ signals: [] });

  const signals = await signalsService.list(ctx, {});
  return NextResponse.json({
    workspaceId: ctx.workspace.id,
    signals: signals.slice(0, 20).map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      severity: s.severity,
      source: s.source,
      correlationId: s.correlationId,
    })),
  });
}
