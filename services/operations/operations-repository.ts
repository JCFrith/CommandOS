import type { Operation, OperationActivity } from '@/types';

/**
 * Persistence boundary for {@link Operation} records and their activity
 * timeline. The rest of the app depends only on this interface; the concrete
 * backing store is injected, keeping domain logic decoupled from the database.
 *
 * The store is a dumb persistence layer: it reads and writes fully-formed
 * records. Identity generation, timestamps, lifecycle rules, authorization and
 * activity construction are the {@link OperationsService}'s job — so swapping
 * this for a Supabase-backed adapter later touches only row mapping, never
 * domain logic.
 *
 * Every method is scoped by `workspaceId` for tenant isolation (defense in depth
 * alongside the service's workspace resolution).
 */
export interface OperationsRepository {
  /** All operations in a workspace (unordered; callers sort for display). */
  listByWorkspace(workspaceId: string): Promise<Operation[]>;
  /** A single operation, or `null` if absent or outside the workspace. */
  getById(workspaceId: string, id: string): Promise<Operation | null>;
  /** Persist a new operation record. */
  create(operation: Operation): Promise<Operation>;
  /** Replace an existing operation record. */
  update(operation: Operation): Promise<Operation>;
  /** Timeline entries for an operation (unordered; callers sort for display). */
  listActivity(workspaceId: string, operationId: string): Promise<OperationActivity[]>;
  /** Append an immutable activity entry. */
  appendActivity(activity: OperationActivity): Promise<OperationActivity>;
}
