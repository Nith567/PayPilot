import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { automations } from '@/lib/db';

// Pause / resume / delete a condition automation.
export const POST = withAuth(async (req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'payout:create');

  const rule = await (await automations()).findOne({ _id: id, orgId: m.org._id });
  if (!rule) return apiError('Automation not found', 404);

  const body = await req.json();
  const action = String(body?.action ?? '');

  if (action === 'pause' && rule.status === 'active') {
    await (await automations()).updateOne({ _id: id }, { $set: { status: 'paused' } });
    return json({ automation: { ...rule, status: 'paused' } });
  }
  if (action === 'resume' && rule.status === 'paused') {
    await (await automations()).updateOne({ _id: id }, { $set: { status: 'active', lastFiredAt: null } });
    return json({ automation: { ...rule, status: 'active' } });
  }
  if (action === 'delete') {
    await (await automations()).deleteOne({ _id: id });
    return json({ deleted: true });
  }

  return apiError('Invalid action or state');
});
