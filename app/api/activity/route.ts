import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { activity } from '@/lib/db';

// Recent activity feed for the current org (dashboard overview).
export const GET = withAuth(async (_req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  const list = await (await activity())
    .find({ orgId: m.org._id })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
  return json({ activity: list });
});
