import type { Operation } from '@/types';

/**
 * Persistence boundary for {@link Operation} records. The rest of the app
 * depends only on this interface; the concrete backing store (Supabase) is
 * injected, keeping domain logic decoupled from the database.
 */
export interface OperationsRepository {
  list(): Promise<Operation[]>;
  get(id: string): Promise<Operation | null>;
  create(input: Pick<Operation, 'title'>): Promise<Operation>;
}
