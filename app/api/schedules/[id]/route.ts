import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { logActivity, schedules } from '@/lib/db';

// Pause / resume / delete a schedule.
export const POST = withAuth(async (req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'payout:create');

  const schedule = await (await schedules()).findOne({ _id: id, orgId: m.org._id });
  if (!schedule) return apiError('Schedule not found', 404);

  const body = await req.json();
  const action = String(body?.action ?? '');

  if (action === 'pause' && schedule.status === 'active') {
    await (await schedules()).updateOne({ _id: id }, { $set: { status: 'paused' } });
    await logActivity({
      orgId: m.org._id,
      type: 'payout_requested',
      message: `Schedule paused: $${schedule.amountUsdc} → ${schedule.vendorName ?? schedule.recipient.slice(0, 10)}`,
    });
    return json({ schedule: { ...schedule, status: 'paused' } });
  }
  if (action === 'resume' && schedule.status === 'paused') {
    await (await schedules()).updateOne(
      { _id: id },
      { $set: { status: 'active', nextRunAt: Date.now() + 60_000 } },
    );
    await logActivity({
      orgId: m.org._id,
      type: 'payout_requested',
      message: `Schedule resumed: $${schedule.amountUsdc} → ${schedule.vendorName ?? schedule.recipient.slice(0, 10)}`,
    });
    return json({ schedule: { ...schedule, status: 'active' } });
  }
  if (action === 'delete') {
    await (await schedules()).deleteOne({ _id: id });
    return json({ deleted: true });
  }

  return apiError('Invalid action or state');
});
