import type { NextRequest } from 'next/server';
import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { optionalEnv } from '@/lib/env';
import { runAllDueSchedules, runDueSchedules } from '@/lib/schedules';
import { runAllDueAutomations, runDueAutomations } from '@/lib/automations';

// Fires due schedules + condition automations. Two callers:
//  - Vercel cron (daily, vercel.json) → Bearer CRON_SECRET → all orgs.
//  - In-app tick (any authenticated member, so localhost works without cron)
//    → the caller's own org.
export async function POST(req: NextRequest) {
  const cronSecret = optionalEnv('CRON_SECRET');
  const auth = req.headers.get('authorization');

  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    const [schedules, automations] = await Promise.all([
      runAllDueSchedules(),
      runAllDueAutomations(),
    ]);
    return json({ ok: true, fired: schedules + automations });
  }

  return withAuth(async (_req, userId) => {
    const m = await resolveMembershipForUser(userId);
    if (!m) return apiError('No organization', 404);
    const [schedules, automations] = await Promise.all([
      runDueSchedules(m.org),
      runDueAutomations(m.org),
    ]);
    return json({ ok: true, fired: schedules + automations });
  })(req, { params: Promise.resolve({}) });
}
