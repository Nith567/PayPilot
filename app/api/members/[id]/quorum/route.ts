import { apiError, json, withAuth } from '@/lib/api-helpers';
import { getBearerToken } from '@/lib/auth';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { getOrgSignerPrivateKeyBase64 } from '@/lib/app-signer';
import { privy } from '@/lib/privy';
import { mutateQuorum } from '@/lib/governance';
import { logActivity, members } from '@/lib/db';
import { ROLE_LABELS } from '@/lib/types';

// Owner adds an activated Treasurer to the org's key quorums (main + ops),
// making them a real signer on every wallet.
//  - Ops quorum runs at threshold 1 → the owner's signature applies the
//    change immediately.
//  - Main quorum: if its threshold is 1, immediate; once it is ≥ 2, the
//    change itself needs quorum approval — it becomes a governance intent
//    the signers approve in the UI (Privy applies it at threshold).
export const POST = withAuth(async (req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'member:manage');

  const member = await (await members()).findOne({ _id: id, orgId: m.org._id });
  if (!member) return apiError('Member not found', 404);
  if (member.status !== 'active' || !member.privyUserId) {
    return apiError('Member must accept their invite first', 409);
  }
  if (member.role !== 'treasurer') {
    return apiError('Only treasurers become quorum signers (owner is already one)', 400);
  }
  if (member.inQuorum) return apiError('Already a quorum signer', 409);

  const token = getBearerToken(req);
  if (!token) return apiError('Missing session token', 401);

  // 1) Ops quorum (threshold 1) — immediate, signed by the org signer key
  const opsQuorum = await privy().keyQuorums().get(m.org.opsQuorumId);
  const opsUserIds = [...(opsQuorum.user_ids ?? [])];
  if (!opsUserIds.includes(member.privyUserId)) {
    opsUserIds.push(member.privyUserId);
    await privy().keyQuorums().update(m.org.opsQuorumId, {
      authorization_context: {
        authorization_private_keys: [getOrgSignerPrivateKeyBase64()],
      },
      user_ids: opsUserIds,
      public_keys: (opsQuorum.authorization_keys ?? []).map((k) => k.public_key),
      key_quorum_ids: opsQuorum.key_quorum_ids,
      authorization_threshold: opsQuorum.authorization_threshold ?? 1,
    });
  }

  // 2) Main quorum — direct when threshold ≤ 1, governance intent otherwise
  const mainQuorum = await privy().keyQuorums().get(m.org.privyQuorumId);
  const mainUserIds = [...(mainQuorum.user_ids ?? [])];
  if (mainUserIds.includes(member.privyUserId)) {
    await (await members()).updateOne({ _id: member._id }, { $set: { inQuorum: true } });
    return json({ member: { ...member, inQuorum: true }, alreadyInQuorum: true });
  }
  mainUserIds.push(member.privyUserId);

  const mainBody = {
    user_ids: mainUserIds,
    key_quorum_ids: mainQuorum.key_quorum_ids,
    authorization_threshold: mainQuorum.authorization_threshold ?? undefined,
  };
  const result = await mutateQuorum({
    orgId: m.org._id,
    quorumId: m.org.privyQuorumId,
    kind: 'add_signer',
    title: `Add ${ROLE_LABELS[member.role]} ${member.email} as a signer`,
    body: mainBody,
    currentThreshold: mainQuorum.authorization_threshold ?? 1,
    ownerToken: token,
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
