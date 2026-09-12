import { apiError, json, withAuth } from '@/lib/api-helpers';
import { getBearerToken } from '@/lib/auth';
import { privy } from '@/lib/privy';
import { logActivity, members } from '@/lib/db';
import { ROLE_LABELS } from '@/lib/types';

// An invited teammate accepts. Verification:
//  - Pregenerated invite → the session's Privy user id is authoritative
//    (Privy logs the invitee's email into the pregenerated user).
//  - Legacy invite → verify the session email matches the invite.
// Becoming a *signer* happens separately when the owner adds them to the
// key quorum.
export const POST = withAuth(async (req, userId, { params }) => {
  const { id } = await params;
  const member = await (await members()).findOne({ _id: id, status: 'invited' });
  if (!member) return apiError('Invite not found or already accepted', 404);

  if (member.privyUserId) {
    if (member.privyUserId !== userId) {
      return apiError('You are signed in with a different Privy account than the invite', 403);
    }
  } else {
    const token = getBearerToken(req);
    if (!token) return apiError('Missing session token', 401);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (await privy().users().get({ id_token: token })) as any;
    const email = String(user?.email?.address ?? '').toLowerCase();
    if (!email || email !== member.email.toLowerCase()) {
      return apiError('This invite is for a different email address', 403);
    }
  }

  await (await members()).updateOne(
    { _id: member._id },
    { $set: { privyUserId: userId, status: 'active' } },
  );
  await logActivity({
    orgId: member.orgId,
    type: 'member_joined',
    message: `${member.email} accepted the ${ROLE_LABELS[member.role]} role`,
  });

  return json({ member: { ...member, privyUserId: userId, status: 'active' } });
});
