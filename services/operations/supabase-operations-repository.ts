import 'server-only';

import type { Operation, OperationActivity, OperationStatus } from '@/types';
import { serviceClient } from '@/lib/supabase/service';
import type { OperationsRepository } from './operations-repository';

interface OpRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}
interface ActRow {
  id: string;
  workspace_id: string;
  operation_id: string;
  actor_id: string;
  actor_name: string;
  type: string;
  message: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
}
const toOp = (r: OpRow): Operation => ({
  id: r.id,
  workspaceId: r.workspace_id,
  title: r.title,
  description: r.description,
  status: r.status as OperationStatus,
  priority: r.priority as Operation['priority'],
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toAct = (r: ActRow): OperationActivity => ({
  id: r.id,
  operationId: r.operation_id,
  workspaceId: r.workspace_id,
  actorId: r.actor_id,
  actorName: r.actor_name,
  type: r.type as OperationActivity['type'],
  message: r.message,
  fromStatus: r.from_status as OperationStatus | null,
  toStatus: r.to_status as OperationStatus | null,
  createdAt: r.created_at,
});

/**
 * PRODUCTION {@link OperationsRepository} over Postgres (service-role, every query
 * `workspace_id`-scoped). Pure row-mapping — identity/timestamps/lifecycle/authz
 * stay in the service, so this is a binding swap with no domain change. Activity
 * is append-only (DB triggers) and returned chronologically.
 */
export class SupabaseOperationsRepository implements OperationsRepository {
  private get db() {
    return serviceClient();
  }

  async listByWorkspace(workspaceId: string): Promise<Operation[]> {
    const { data, error } = await this.db
      .from('operations')
      .select()
      .eq('workspace_id', workspaceId);
    if (error) throw new Error(error.message);
    return (data as OpRow[]).map(toOp);
  }
  async getById(workspaceId: string, id: string): Promise<Operation | null> {
    const { data, error } = await this.db
      .from('operations')
      .select()
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toOp(data as OpRow) : null;
  }
  async create(op: Operation): Promise<Operation> {
    const { error } = await this.db.from('operations').insert({
      id: op.id,
      workspace_id: op.workspaceId,
      title: op.title,
      description: op.description,
      status: op.status,
      priority: op.priority,
      created_by: op.createdBy,
      updated_by: op.updatedBy,
      created_at: op.createdAt,
      updated_at: op.updatedAt,
    });
    if (error) throw new Error(error.message);
    return op;
  }
  async update(op: Operation): Promise<Operation> {
    const { error } = await this.db
      .from('operations')
      .update({
        title: op.title,
        description: op.description,
        status: op.status,
        priority: op.priority,
        updated_by: op.updatedBy,
      })
      .eq('workspace_id', op.workspaceId)
      .eq('id', op.id);
    if (error) throw new Error(error.message);
    return op;
  }
  async listActivity(workspaceId: string, operationId: string): Promise<OperationActivity[]> {
    const { data, error } = await this.db
      .from('operation_activity')
      .select()
      .eq('workspace_id', workspaceId)
      .eq('operation_id', operationId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as ActRow[]).map(toAct);
  }
  async appendActivity(a: OperationActivity): Promise<OperationActivity> {
    const { error } = await this.db.from('operation_activity').insert({
      id: a.id,
      workspace_id: a.workspaceId,
      operation_id: a.operationId,
      actor_id: a.actorId,
      actor_name: a.actorName,
      type: a.type,
      message: a.message,
      from_status: a.fromStatus,
      to_status: a.toStatus,
      created_at: a.createdAt,
    });
    if (error) throw new Error(error.message);
    return a;
  }
}
