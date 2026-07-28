import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { WorkflowForm } from '@/components/os/workflows/workflow-form';

export const metadata: Metadata = { title: 'New Workflow' };

export default function NewWorkflowPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href="/console/workflows"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        Workflows
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New workflow</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Name the workflow and define its graph. It starts as a draft — activate it to enable
        triggers and runs.
      </p>
      <div className="mt-8">
        <WorkflowForm />
      </div>
    </div>
  );
}
