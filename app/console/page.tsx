import Link from 'next/link';
import type { Metadata } from 'next';
import { Activity, ArrowUpRight, Bot, Radio } from 'lucide-react';

import { SectionShell } from '@/components/os/section-shell';

export const metadata: Metadata = { title: 'Console' };

const sections = [
  {
    icon: Bot,
    title: 'Agents',
    href: '/console/agents' as const,
    body: 'Autonomous operators that plan, act, and report.',
  },
  {
    icon: Radio,
    title: 'Signals',
    href: '/console/signals' as const,
    body: 'Live operational telemetry, unified.',
  },
  {
    icon: Activity,
    title: 'Operations',
    href: '/console/operations' as const,
    body: 'Every unit of work, intent to outcome.',
  },
];

export default function ConsolePage() {
  return (
    <SectionShell
      icon={Activity}
      title="Console"
      description="Your operational command center. Press ⌘K anywhere to navigate or dispatch work."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.title}
            href={section.href}
            className="group border-border/60 bg-card/40 hover:border-primary/40 relative overflow-hidden rounded-2xl border p-5 backdrop-blur transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="bg-primary/10 text-primary ring-primary/20 grid size-9 place-items-center rounded-lg ring-1">
                <section.icon className="size-4.5" />
              </span>
              <ArrowUpRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <h2 className="mt-4 text-sm font-semibold">{section.title}</h2>
            <p className="text-muted-foreground mt-1.5 text-sm">{section.body}</p>
          </Link>
        ))}
      </div>
    </SectionShell>
  );
}
