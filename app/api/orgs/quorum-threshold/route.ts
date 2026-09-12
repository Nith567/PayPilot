import { apiError, json, withAuth } from '@/lib/api-helpers';
import { getBearerToken } from '@/lib/auth';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { privy } from '@/lib/privy';
import { mutateQuorum } from '@/lib/governance';
import { logActivity, orgs } from '@/lib/db';

// Owner sets the main-quorum approval threshold (1-of-N … N-of-N).
//  - While the current threshold is 1, the change applies immediately
//    (owner's signature alone satisfies it).
//  - Once the threshold is ≥ 2, the change itself needs quorum approval —
//    it goes out as a governance intent that signers approve in the UI.
export const POST = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'member:manage');

  const body = await req.json();
  const threshold = Number(body?.threshold);
  if (!Number.isInteger(threshold) || threshold < 1) {
    return apiError('Threshold must be a positive integer');
  }

  const token = getBearerToken(req);
  if (!token) return apiError('Missing session token', 401);

  const quorum = await privy().keyQuorums().get(m.org.privyQuorumId);
  const memberCount = (quorum.user_ids ?? []).length;
  if (threshold > memberCount) {
    return apiError(`Threshold cannot exceed the quorum size (${memberCount} member${memberCount === 1 ? '' : 's'})`);
  }
  const currentThreshold = quorum.authorization_threshold ?? 1;

  const result = await mutateQuorum({
    orgId: m.org._id,
    quorumId: m.org.privyQuorumId,
    kind: 'set_threshold',
    title: `Set main quorum threshold to ${threshold}-of-${memberCount}`,
    body: {
      user_ids: quorum.user_ids ?? undefined,
      key_quorum_ids: quorum.key_quorum_ids,
      authorization_threshold: threshold,
    },
    currentThreshold,
    ownerToken: token,
  });

  if (result.direct) {
    await (await orgs()).updateOne({ _id: m.org._id }, { $set: { quorumThreshold: threshold } });
    await logActivity({
      orgId: m.org._id,
      type: 'settings_updated',
      message: `Main quorum threshold set to ${threshold}-of-${memberCount}`,
    });
    return json({ org: { ...m.org, quorumThreshold: threshold }, direct: true });
  }

  return json({ org: m.org, direct: false, pendingGovernance: true });
});
