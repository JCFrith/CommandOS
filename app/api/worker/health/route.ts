import { NextResponse, type NextRequest } from 'next/server';

import { durableHealth } from '@/services/jobs';

/**
 * Durable-runtime Health/Metrics endpoint. Returns aggregate measurements only
 * (backlogs, overdue counts + ages, resume queue depth, per-pass liveness) — no
 * per-row data, no secrets. `null` where a value is genuinely unmeasurable (e.g.
 * schedule backlog for interval schedules, or all DB aggregates in in-memory mode).
 *
 * Protected by the same `CRON_SECRET` as the worker endpoint when configured, so
 * operational telemetry is not world-readable; unauthenticated only in local dev.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  return NextResponse.json({ ok: true, ...(await durableHealth()) });
}
