import { logActivity, orgs, schedules } from './db';
import { createOrgPayout } from './payouts';
import type { OrgDoc, ScheduleFrequency } from './types';

// Scheduled payments: a schedule is just a payout that fires on time. When
// due, it enters the exact same pipeline as a manual request — amount-tier
// routing, policy gates, Privy intent, quorum approval. Scheduled money gets
// no special treatment; policy applies to automation the same as to humans.

const DAY_MS = 86_400_000;
const FREQ_MS: Record<Exclude<ScheduleFrequency, 'once'>, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
  monthly: 30 * DAY_MS,
};

export function nextRunAfter(now: number, frequency: ScheduleFrequency): number {
  if (frequency === 'once') return now;
  return now + FREQ_MS[frequency];
}

// Fire all due schedules for one org. Policy-gate failures pause the
// schedule (a vendor removed from the allowlist must not keep failing
// silently forever — the activity feed says exactly what happened).
export async function runDueSchedules(org: OrgDoc): Promise<number> {
  const due = await (await schedules())
    .find({ orgId: org._id, status: 'active', nextRunAt: { $lte: Date.now() } })
    .toArray();

  for (const sched of due) {
    const result = await createOrgPayout(org, {
      recipient: sched.recipient,
      amountUsdc: sched.amountUsdc,
      memo: `[scheduled] ${sched.memo}`,
      creatorName: 'Schedule',
    });

    if (result.denied) {
      await (await schedules()).updateOne(
        { _id: sched._id },
        { $set: { status: 'paused' } },
      );
      await logActivity({
        orgId: org._id,
        type: 'payout_denied',
        message: `Schedule paused — policy gate failed: ${result.reason} (${sched.vendorName ?? sched.recipient.slice(0, 10)})`,
      });
      continue;
    }

    const now = Date.now();
    if (sched.frequency === 'once') {
      await (await schedules()).updateOne(
        { _id: sched._id },
        { $set: { status: 'completed', lastRunAt: now, nextRunAt: now } },
      );
    } else {
      await (await schedules()).updateOne(
        { _id: sched._id },
        { $set: { lastRunAt: now, nextRunAt: nextRunAfter(now, sched.frequency) } },
      );
    }
    await logActivity({
      orgId: org._id,
      type: 'payout_requested',
      message: `Scheduled payout fired: $${sched.amountUsdc} → ${sched.vendorName ?? sched.recipient.slice(0, 10)} (${sched.frequency})`,
    });
  }
  return due.length;
}

// Cron entry point: every org's due schedules.
export async function runAllDueSchedules(): Promise<number> {
  const allOrgs = await (await orgs()).find({}).toArray();
  let fired = 0;
  for (const org of allOrgs) fired += await runDueSchedules(org);
  return fired;
}
