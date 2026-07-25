import type { Operation, OperationActivity } from '@/types';
import type { OperationsRepository } from './operations-repository';

/**
 * DEVELOPMENT-ONLY {@link OperationsRepository}.
 *
 * Holds operations and their activity in a worker process's memory. State
 * persists across requests served by the SAME worker and resets on restart —
 * ideal for local development and tests, NOT for production.
 *
 * Limitation: a multi-worker server (`next start`, serverless) does not share
 * this memory across workers, so a write on one worker isn't visible to a read
 * routed to another. The production path is the Supabase-backed adapter,
 * scheduled with the operations migration in a later sprint (see
 * `docs/roadmap.md` / `TECH_DEBT.md`). Because callers depend only on
 * {@link OperationsRepository}, that adapter drops in via the
 * `operationsRepository` export below without touching service or UI code.
 *
 * Records are cloned on the way in and out so callers can never mutate stored
 * state by reference.
 */
export class InMemoryOperationsRepository implements OperationsRepository {
  private readonly operations = new Map<string, Operation>();
  private readonly activities: OperationActivity[] = [];

  private static clone<T>(value: T): T {
    return structuredClone(value);
  }

  async listByWorkspace(workspaceId: string): Promise<Operation[]> {
    return [...this.operations.values()]
      .filter((op) => op.workspaceId === workspaceId)
      .map((op) => InMemoryOperationsRepository.clone(op));
  }

  async getById(workspaceId: string, id: string): Promise<Operation | null> {
    const op = this.operations.get(id);
    if (!op || op.workspaceId !== workspaceId) return null;
    return InMemoryOperationsRepository.clone(op);
  }

  async create(operation: Operation): Promise<Operation> {
    this.operations.set(operation.id, InMemoryOperationsRepository.clone(operation));
    return InMemoryOperationsRepository.clone(operation);
  }

  async update(operation: Operation): Promise<Operation> {
    this.operations.set(operation.id, InMemoryOperationsRepository.clone(operation));
    return InMemoryOperationsRepository.clone(operation);
  }

  async listActivity(workspaceId: string, operationId: string): Promise<OperationActivity[]> {
    return this.activities
      .filter((a) => a.workspaceId === workspaceId && a.operationId === operationId)
      .map((a) => InMemoryOperationsRepository.clone(a));
  }

  async appendActivity(activity: OperationActivity): Promise<OperationActivity> {
    this.activities.push(InMemoryOperationsRepository.clone(activity));
    return InMemoryOperationsRepository.clone(activity);
  }
}

/**
 * The active operations repository. Development uses the in-memory store above;
 * swap this single binding for the Supabase adapter when it lands.
 *
 * Pinned to `globalThis` outside production so the store survives module
 * re-evaluation from HMR during `next dev` (the standard Next dev-singleton
 * pattern) — a create then made visible to a subsequent read on the same worker.
 */
const globalForOperations = globalThis as typeof globalThis & {
  __operationsRepository?: OperationsRepository;
};

export const operationsRepository: OperationsRepository =
  globalForOperations.__operationsRepository ?? new InMemoryOperationsRepository();

if (process.env.NODE_ENV !== 'production') {
  globalForOperations.__operationsRepository = operationsRepository;
}
