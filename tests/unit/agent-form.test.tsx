import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Isolate from the server-action module (and its server-only AI deps).
vi.mock('@/app/console/agents/actions', () => ({
  createAgentAction: vi.fn(async () => ({ error: null })),
  updateAgentAction: vi.fn(async () => ({ error: null })),
}));

import { AgentForm } from '@/components/os/agents/agent-form';

describe('AgentForm', () => {
  it('renders name, type, capabilities and the create button', () => {
    render(<AgentForm mode="create" cancelHref="/console/agents" />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByText('Capabilities')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create agent' })).toBeInTheDocument();
  });

  it('shows a validation error when submitting without a name', async () => {
    render(<AgentForm mode="create" cancelHref="/console/agents" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    expect(await screen.findByText('Give the agent a name.')).toBeInTheDocument();
  });

  it('hides the type field and prefills values in edit mode', () => {
    render(
      <AgentForm
        mode="edit"
        agentId="a-1"
        initial={{
          name: 'Briefer',
          type: 'executive',
          description: 'Daily brief',
          instructions: 'Be concise',
          capabilities: ['summarize'],
        }}
        cancelHref="/console/agents/a-1"
      />,
    );
    expect(screen.getByDisplayValue('Briefer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});
