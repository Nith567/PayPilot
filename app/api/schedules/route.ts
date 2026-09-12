import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { logActivity, newId, schedules, vendors } from '@/lib/db';
import { ROLE_LABELS, type ScheduleDoc, type ScheduleFrequency } from '@/lib/types';

const FREQUENCIES: ScheduleFrequency[] = ['daily', 'weekly', 'monthly', 'once'];

export const GET = withAuth(async (_req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  const list = await (await schedules())
    .find({ orgId: m.org._id })
    .sort({ nextRunAt: 1 })
    .toArray();
  return json({ schedules: list });
});

// Create a recurring (or one-shot) payout schedule. Recipients must be
// onboarded vendors — the same allowlist the wallet policies enforce.
export const POST = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'payout:create');

  const body = await req.json();
  const recipient = String(body?.recipient ?? '').trim();
  const amountUsdc = Number(body?.amountUsdc);
  const frequency = String(body?.frequency ?? '') as ScheduleFrequency;
  const memo = String(body?.memo ?? '').trim().slice(0, 280);
  const startInMinutes = Math.max(0, Number(body?.startInMinutes ?? 1));

  if (!recipient || !Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    return apiError('recipient and a positive amountUsdc are required');
  }
  if (!FREQUENCIES.includes(frequency)) {
    return apiError('frequency must be daily, weekly, monthly or once');
  }

  const vendor = await (await vendors()).findOne({ orgId: m.org._id, address: recipient });
  if (!vendor) return apiError('Schedules require an onboarded vendor (policy allowlist)');

  const doc: ScheduleDoc = {
    _id: newId(),
    orgId: m.org._id,
    recipient: vendor.address,
    vendorName: vendor.name,
    amountUsdc,
    frequency,
    nextRunAt: Date.now() + startInMinutes * 60_000,
    lastRunAt: null,
    memo,
    creatorName: ROLE_LABELS[m.role],
    status: 'active',
    createdAt: Date.now(),
  };
  await (await schedules()).insertOne(doc);
  await logActivity({
    orgId: m.org._id,
    type: 'payout_requested',
    message: `Schedule created: $${amountUsdc} → ${vendor.name}, ${frequency}${
      frequency !== 'once' ? '' : ' (one-shot)'
    } — first run ${new Date(doc.nextRunAt).toLocaleString()}`,
  });

  return json({ schedule: doc }, 201);
});
