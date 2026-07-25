'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, CircleDot, Command, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCommandPalette } from '@/store/command-palette';

const panels = [
  {
    icon: Sparkles,
    title: 'Agents',
    body: 'Autonomous operators that plan, act, and report across your stack.',
  },
  {
    icon: Zap,
    title: 'Signals',
    body: 'Real-time operational telemetry unified into a single context surface.',
  },
  {
    icon: CircleDot,
    title: 'Operations',
    body: 'Every task — human or agent-initiated — tracked from intent to outcome.',
  },
];

/**
 * The CommandOS entry surface. Deliberately not a dashboard: it presents the
 * system as a living operating environment that boots in, invites a command,
 * and hints at the ambient intelligence underneath.
 */
export function CommandSurface() {
  const reduce = useReducedMotion();
  const setOpen = useCommandPalette((s) => s.setOpen);

  const fade = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <AmbientBackdrop />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary/15 text-primary ring-primary/25 grid size-8 place-items-center rounded-lg ring-1">
            <Command className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">CommandOS</span>
        </div>
        <span className="border-border/60 bg-card/40 text-muted-foreground flex items-center gap-2 rounded-full border px-3 py-1 text-xs backdrop-blur">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          systems nominal
        </span>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <motion.p
          {...fade(0.05)}
          className="border-border/60 bg-card/40 text-muted-foreground mb-5 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur"
        >
          <Sparkles className="text-primary size-3.5" />
          AI-native operations platform
        </motion.p>

        <motion.h1
          {...fade(0.12)}
          className="max-w-3xl text-5xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl"
        >
          Command your entire operation from a single{' '}
          <span className="from-primary via-accent to-primary bg-gradient-to-r bg-clip-text text-transparent">
            intelligent surface
          </span>
          .
        </motion.h1>

        <motion.p {...fade(0.2)} className="text-muted-foreground mt-6 max-w-xl text-lg">
          CommandOS unifies agents, signals, and operations into one context-aware environment — so
          your team moves at the speed of intent.
        </motion.p>

        <motion.div {...fade(0.28)} className="mt-9 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="group">
            <Link href="/console">
              Enter CommandOS
              <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" onClick={() => setOpen(true)}>
            <Command className="size-4" />
            Press ⌘K to command
          </Button>
        </motion.div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {panels.map((panel, i) => (
            <motion.article
              key={panel.title}
              {...fade(0.36 + i * 0.08)}
              className="group border-border/60 bg-card/40 hover:border-primary/40 relative overflow-hidden rounded-2xl border p-5 backdrop-blur transition-colors"
            >
              <span className="bg-primary/10 text-primary ring-primary/20 grid size-9 place-items-center rounded-lg ring-1">
                <panel.icon className="size-4.5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold">{panel.title}</h3>
              <p className="text-muted-foreground mt-1.5 text-sm">{panel.body}</p>
              <div className="via-primary/40 pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            </motion.article>
          ))}
        </div>
      </section>
    </main>
  );
}

function AmbientBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="bg-primary/20 absolute top-[-10%] left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full blur-[120px]" />
      <div className="bg-accent/15 absolute right-[-10%] bottom-[-20%] h-[36rem] w-[36rem] rounded-full blur-[120px]" />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
    </div>
  );
}
