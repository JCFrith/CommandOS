import { getWorkspaceContext, type WorkspaceContext } from '@/services/workspace/context';

/**
 * The operations caller context. A thin alias over the shared
 * {@link getWorkspaceContext} so operations and agents resolve the workspace
 * identically (and both honor a requested workspace id for palette scoping).
 */
export function getOperationsContext(
  requestedWorkspaceId?: string,
): Promise<WorkspaceContext | null> {
  return getWorkspaceContext(requestedWorkspaceId);
}
