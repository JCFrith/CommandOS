import 'server-only';

import type { SignalFilter, SignalSubscription } from '@/lib/signals/types';
import type { SignalSubscriptionRepository } from '@/lib/signals/subscription';
import { serviceClient } from '@/lib/supabase/service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toSub = (r: any): SignalSubscription => ({
  id: r.id,
  workspaceId: r.workspace_id,
  filter: r.filter as SignalFilter,
  channelRefs: r.channel_refs ?? [],
  active: r.active,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** PRODUCTION {@link SignalSubscriptionRepository} over Postgres (service-role). */
export class SupabaseSignalSubscriptionRepository implements SignalSubscriptionRepository {
  private get db() {
    return serviceClient();
  }

  async create(s: SignalSubscription): Promise<SignalSubscription> {
    const { error } = await this.db.from('signal_subscriptions').insert({
      id: s.id,
      workspace_id: s.workspaceId,
      filter: s.filter,
      channel_refs: s.channelRefs,
      active: s.active,
      created_at: s.createdAt,
    });
    if (error) throw new Error(error.message);
    return s;
  }
  async get(id: string): Promise<SignalSubscription | null> {
    const { data, error } = await this.db
      .from('signal_subscriptions')
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toSub(data) : null;
  }
  async listActive(workspaceId: string): Promise<SignalSubscription[]> {
    const { data, error } = await this.db
      .from('signal_subscriptions')
      .select()
      .eq('active', true)
      .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    if (error) throw new Error(error.message);
    return (data ?? []).map(toSub);
  }
  async setActive(id: string, active: boolean): Promise<void> {
    const { error } = await this.db.from('signal_subscriptions').update({ active }).eq('id', id);
    if (error) throw new Error(error.message);
  }
}
