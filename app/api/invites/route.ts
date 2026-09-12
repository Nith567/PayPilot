import { json, withAuth } from '@/lib/api-helpers';
import { getBearerToken } from '@/lib/auth';
import { privy } from '@/lib/privy';
import { members, orgs } from '@/lib/db';
import type { MemberDoc } from '@/lib/types';

// Pending invites for the signed-in user. Pregenerated invites bind the
// invitee's Privy user id at invite time, so the match is direct. Legacy
// invites (no pregenerated user) fall back to a session-email match.
export const GET = withAuth(async (req, userId) => {
  const byUserId = await (await members())
    .find({ status: 'invited', privyUserId: userId })
    .toArray();

  const byEmail: MemberDoc[] = [];
  try {
    const token = getBearerToken(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (await privy().users().get({ id_token: token ?? '' })) as any;
    const email = String(user?.email?.address ?? '').toLowerCase();
    if (email) {
      const emailMatches = await (await members())
        .find({ status: 'invited', email, privyUserId: null })
        .toArray();
      byEmail.push(...emailMatches);
    }
  } catch {
    // Best-effort: legacy email matching may be unavailable — the direct
    // user-id match above covers all pregenerated invites.
  }

  const all = [...byUserId, ...byEmail].filter(
    (m, i, arr) => arr.findIndex((x) => x._id === m._id) === i,
  );
  const withOrgNames = await Promise.all(
    all.map(async (m) => {
      const org = await (await orgs()).findOne({ _id: m.orgId });
      return { ...m, orgName: org?.name ?? 'Unknown org' };
    }),
  );
  return json({ invites: withOrgNames });
});
