import type { WorkflowDefinitionInput } from './schema';

/**
 * A valid starter workflow definition, offered as the default when creating a
 * workflow. It demonstrates the platform end to end — create an operation, then
 * gate on a human approval — without requiring a visual graph editor (which is
 * out of scope this sprint; see TECH_DEBT). Operators edit the JSON to author
 * their own graph; every definition is validated on publish.
 */
export const STARTER_DEFINITION: WorkflowDefinitionInput = {
  variables: [{ key: 'topic', type: 'string', required: false, default: 'Q3 review' }],
  triggers: [{ type: 'manual' }],
  startNodeId: 'start',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: { type: 'start' } },
    {
      id: 'create-op',
      type: 'operation_create',
      name: 'Create operation',
      config: {
        type: 'operation_create',
        titleTemplate: 'Prepare {{topic}}',
        priority: 'medium',
        outputVar: 'operationId',
      },
    },
    {
      id: 'approve',
      type: 'approval',
      name: 'Approve',
      config: { type: 'approval', approvers: 'owner', prompt: 'Proceed with {{topic}}?' },
    },
    { id: 'done', type: 'end', name: 'Done', config: { type: 'end' } },
  ],
  edges: [
    { from: 'start', to: 'create-op' },
    { from: 'create-op', to: 'approve' },
    { from: 'approve', to: 'done' },
  ],
};

export const STARTER_DEFINITION_JSON = JSON.stringify(STARTER_DEFINITION, null, 2);
