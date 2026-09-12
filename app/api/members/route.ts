import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { logActivity, members, newId } from '@/lib/db';
import { ensurePregeneratedUser } from '@/lib/members';
import { ROLE_LABELS, type MemberRole } from '@/lib/types';

const INVITABLE_ROLES: MemberRole[] = ['treasurer', 'finance_officer', 'viewer'];

// Invite a teammate (Owner only). The invite is an app-DB record; the invitee
// accepts on their next login and the owner then adds them to the Privy key
// quorum (POST /api/members/[id]/quorum) — the money-critical step.
export const POST = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'member:manage');

  const body = await req.json();
  const email = String(body?.email ?? '').trim().toLowerCase().slice(0, 254);
  const role = String(body?.role ?? '') as MemberRole;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError('A valid email is required');
  if (!INVITABLE_ROLES.includes(role)) return apiError('Role must be treasurer, finance_officer or viewer');

  const existing = await (await members()).findOne({ orgId: m.org._id, email });
  if (existing) return apiError('That email already has a role in this org', 409);

  // Pregenerate the employee's Privy user + embedded wallet so it's ready
  // the moment they accept. If it fails, the invite still works the legacy
  // way (they bring their own Privy account on login).
  let privyUserId: string | null = null;
  let pregenerated = false;
  try {
    const result = await ensurePregeneratedUser(email);
    privyUserId = result.userId;
    pregenerated = result.pregenerated;
  } catch (err) {
    console.error('[members] pregeneration failed, inviting without wallet:', err);
  }

  const doc = {
    _id: newId(),
    orgId: m.org._id,
    privyUserId,
    email,
    role,
    status: 'invited' as const,
    inQuorum: false,
    pregenerated,
    createdAt: Date.now(),
  };
  await (await members()).insertOne(doc);
  await logActivity({
    orgId: m.org._id,
    type: 'member_invited',
    message: `${ROLE_LABELS[role]} invited: ${email}${pregenerated ? ' (wallet pregenerated)' : ''}`,
  });

  return json({ member: doc }, 201);
});
