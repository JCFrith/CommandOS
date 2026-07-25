/**
 * Pure helpers for the ⌘K palette's workspace-scoped data. Query keys embed the
 * active workspace id so switching workspaces uses a distinct cache entry —
 * results from a previously selected workspace can never appear after a switch
 * (the fix for TD-13). Requests carry the same id; the server honors it only for
 * a workspace the caller belongs to. Extracted here so the scoping is unit
 * testable without rendering the palette.
 */

export function paletteOperationsKey(workspaceId: string | null) {
  return ['palette-operations', workspaceId] as const;
}

export function paletteAgentsKey(workspaceId: string | null) {
  return ['palette-agents', workspaceId] as const;
}

export function paletteOperationsUrl(workspaceId: string): string {
  return `/api/operations?workspaceId=${encodeURIComponent(workspaceId)}`;
}

export function paletteAgentsUrl(workspaceId: string): string {
  return `/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`;
}
