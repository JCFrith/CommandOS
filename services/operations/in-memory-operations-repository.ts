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
 * Pinned to `globalThis` so that, WITHIN a single JS realm, one store is shared
 * across every copy of this module's graph. This matters because Next bundles
 * Server Actions, Route Handlers and page RSCs as separate graphs — without the
 * pin each gets its own `Map`, and a create via an action wouldn't be visible to
 * a read in a page render even in the same realm. It also survives HMR
 * re-evaluation under `next dev`. The pin is unconditional because this is the
 * development store; the production Supabase adapter (shared by construction — a
 * database) replaces this binding, so the pin never affects the production path.
 *
 * It does NOT bridge separate realms: `next start` (and serverless) fan requests
 * across multiple worker processes/threads, each with its own `globalThis`, so a
 * write handled by one worker isn't visible to a read on another. That is the
 * fundamental in-memory limitation (TECH_DEBT TD-09) the Supabase adapter closes.
 * The workflows are exercised in a single realm by the unit/integration tests.
 */
const globalForOperations = globalThis as typeof globalThis & {
  __operationsRepository?: OperationsRepository;
};

export const operationsRepository: OperationsRepository =
  globalForOperations.__operationsRepository ?? new InMemoryOperationsRepository();

globalForOperations.__operationsRepository = operationsRepository;
