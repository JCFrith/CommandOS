import 'server-only';

import type { Workspace } from '@/types';
import type { WorkspaceContext } from '@/services/workspace/context';
import type { AgentStepResult, WorkflowCapabilities } from '@/lib/workflows/runtime/ports';
import type { WorkflowRunContext } from '@/lib/workflows/types';
import { agentService } from '@/services/agents';
import { operationsService } from '@/services/operations/operations-service';

/**
 * The workflow capability adapter — the wiring seam where workflow steps reach
 * the real feature services (and, through the agent service, the AI runtime).
 *
 * This is where the workflow → services → AI dependency lives, NOT in the
 * runtime (which depends only on the {@link WorkflowCapabilities} port). Each
 * action runs through the authoritative service, so RBAC + workspace scoping +
 * the agent trust boundary are enforced there.
 *
 * The run executes as its operator within its workspace. In the current
 * development model every operator owns their personal workspace, so the adapter
 * reconstructs an owner-scoped {@link WorkspaceContext} from the run context
 * (mirrors D-306). Team-workspace role fidelity for triggered runs is future
 * work (tracked in TECH_DEBT).
 */
function toWorkspaceContext(ctx: WorkflowRunContext): WorkspaceContext {
  const workspace: Workspace = {
    id: ctx.workspaceId,
    name: 'Workspace',
    slug: 'personal',
    role: 'owner',
    kind: 'personal',
  };
  return {
    user: { id: ctx.operatorId, email: null, displayName: ctx.operatorName, avatarUrl: null },
    workspace,
  };
}

export const workflowCapabilities: WorkflowCapabilities = {
  async runAgent(ctx, { agentId, input, correlation }): Promise<AgentStepResult> {
    try {
      // Pass the run's correlation as a TRUSTED, server-side context so the
      // nested agent run + its AI-runtime Signals join the workflow chain.
      const execution = await agentService.execute(
        toWorkspaceContext(ctx),
        agentId,
        { input },
        {
          correlation: {
            correlationId: correlation.correlationId,
            workspaceId: correlation.workspaceId,
            workflowRunId: correlation.workflowRunId,
            workflowStepRunId: correlation.workflowStepRunId,
            causationId: correlation.workflowStepRunId,
            initiatingActorId: correlation.initiatingActorId,
          },
        },
      );
      if (execution.status === 'completed' && execution.result) {
        return {
          ok: true,
          summary: execution.result.summary,
          output: { confidence: execution.result.confidence },
        };
      }
      return {
        ok: false,
        summary: '',
        output: {},
        error: execution.error ?? 'The agent run did not complete.',
      };
    } catch {
      // Never leak service internals into the workflow.
      return { ok: false, summary: '', output: {}, error: 'The agent run could not be completed.' };
    }
  },

  async createOperation(ctx, { title, priority }) {
    const op = await operationsService.create(toWorkspaceContext(ctx), { title, priority });
    return { id: op.id };
  },

  async transitionOperation(ctx, { operationId, to }) {
    await operationsService.transition(toWorkspaceContext(ctx), operationId, { to });
  },
};
