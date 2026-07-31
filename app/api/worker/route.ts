import { NextResponse, type NextRequest } from 'next/server';

import { backgroundWorker } from '@/services/jobs';

/**
 * The stateless background-worker endpoint — the target of a Vercel Cron job
 * (e.g. `* * * * *`). Each invocation drains one batch of due/recoverable work:
 *
 *   Vercel Cron → this route → BackgroundWorker.tick() → LeasedJobStore
 *                → (job handlers) → WorkflowRuntime → Platform Runtime → Signals
 *
 * No persistent process: leases + `claim_jobs` (SKIP LOCKED) make concurrent,
 * crash-safe, at-least-once execution possible across stateless invocations.
 * Protected by a shared `CRON_SECRET` when configured (Vercel Cron sends it as a
 * bearer token); if no secret is set (local dev), it runs unauthenticated.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const result = await backgroundWorker.tick();
  return NextResponse.json({ ok: true, ...result });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
