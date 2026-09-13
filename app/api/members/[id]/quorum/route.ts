import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { addMemberToQuorums } from '@/lib/governance';
import { logActivity, members } from '@/lib/db';
import { ROLE_LABELS } from '@/lib/types';

// Owner adds an activated Treasurer or Finance Officer to the org's key
// quorums (main + ops), making them a real signer on every wallet.
//  - Ops quorum runs at threshold 1 → applied immediately.
//  - Main quorum: if its threshold is ≤ 1, immediate; once it is ≥ 2, the
//    change itself needs quorum approval — it becomes a governance intent
//    the signers approve in the UI (Privy applies it at threshold).
export const POST = withAuth(async (_req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'member:manage');

  const member = await (await members()).findOne({ _id: id, orgId: m.org._id });
  if (!member) return apiError('Member not found', 404);
  if (member.status !== 'active' || !member.privyUserId) {
    return apiError('Member must accept their invite first', 409);
  }
  if (member.role !== 'treasurer' && member.role !== 'finance_officer') {
    return apiError('Only treasurers and finance officers become quorum signers (owner is already one)', 400);
  }
  if (member.inQuorum) return apiError('Already a quorum signer', 409);

  const result = await addMemberToQuorums(m.org, {
    email: member.email,
    role: member.role,
    privyUserId: member.privyUserId,
  });

  if (result.direct) {
    await (await members()).updateOne({ _id: member._id }, { $set: { inQuorum: true } });
    await logActivity({
      orgId: m.org._id,
      type: 'member_signer',
      message: `${ROLE_LABELS[member.role]} ${member.email} added to the key quorums as a signer`,
    });
    return json({ member: { ...member, inQuorum: true } });
  }

  return json({ member, direct: false, pendingGovernance: true });
});
