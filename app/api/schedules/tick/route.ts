import type { NextRequest } from 'next/server';
import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { optionalEnv } from '@/lib/env';
import { runAllDueSchedules, runDueSchedules } from '@/lib/schedules';

// Fires due schedules. Two callers:
//  - Vercel cron (every 5 min, vercel.json) → Bearer CRON_SECRET → all orgs.
//  - In-app tick (any authenticated member, so localhost works without cron)
//    → the caller's own org.
export async function POST(req: NextRequest) {
  const cronSecret = optionalEnv('CRON_SECRET');
  const auth = req.headers.get('authorization');

  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    const fired = await runAllDueSchedules();
    return json({ ok: true, fired });
  }

  return withAuth(async (_req, userId) => {
    const m = await resolveMembershipForUser(userId);
    if (!m) return apiError('No organization', 404);
    const fired = await runDueSchedules(m.org);
    return json({ ok: true, fired });
  })(req, { params: Promise.resolve({}) });
}
