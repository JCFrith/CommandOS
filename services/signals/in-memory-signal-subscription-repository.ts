import type { SignalSubscription } from '@/lib/signals/types';
import type { SignalSubscriptionRepository } from '@/lib/signals/subscription';

/** DEVELOPMENT-ONLY in-memory {@link SignalSubscriptionRepository}. */
export class InMemorySignalSubscriptionRepository implements SignalSubscriptionRepository {
  private readonly subs = new Map<string, SignalSubscription>();

  async create(s: SignalSubscription): Promise<SignalSubscription> {
    this.subs.set(s.id, structuredClone(s));
    return structuredClone(s);
  }
  async get(id: string): Promise<SignalSubscription | null> {
    const s = this.subs.get(id);
    return s ? structuredClone(s) : null;
  }
  async listActive(workspaceId: string): Promise<SignalSubscription[]> {
    return [...this.subs.values()]
      .filter((s) => s.active && (s.workspaceId === null || s.workspaceId === workspaceId))
      .map((s) => structuredClone(s));
  }
  async setActive(id: string, active: boolean): Promise<void> {
    const s = this.subs.get(id);
    if (s) s.active = active;
  }
}
