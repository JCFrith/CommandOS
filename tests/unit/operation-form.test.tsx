import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Isolate the component from the server-action module (and its server-only deps).
vi.mock('@/app/console/operations/actions', () => ({
  createOperationAction: vi.fn(async () => ({ error: null })),
  updateOperationAction: vi.fn(async () => ({ error: null })),
}));

import { OperationForm } from '@/components/os/operations/operation-form';

describe('OperationForm', () => {
  it('renders the title, description and priority fields', () => {
    render(<OperationForm mode="create" cancelHref="/console/operations" />);
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Priority')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create operation' })).toBeInTheDocument();
  });

  it('shows a validation error when submitting without a title', async () => {
    render(<OperationForm mode="create" cancelHref="/console/operations" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create operation' }));
    expect(await screen.findByText('Give the operation a title.')).toBeInTheDocument();
  });

  it('prefills fields in edit mode', () => {
    render(
      <OperationForm
        mode="edit"
        operationId="op-1"
        initial={{ title: 'Existing', description: 'Details', priority: 'high' }}
        cancelHref="/console/operations/op-1"
      />,
    );
    expect(screen.getByDisplayValue('Existing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});
