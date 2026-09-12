import { apiError, json, withAuth } from '@/lib/api-helpers';
import { getBearerToken } from '@/lib/auth';
import { resolveMembershipForUser } from '@/lib/authz';
import { createOrgForUser } from '@/lib/bootstrap';
import { privy } from '@/lib/privy';
import { members, vendors, wallets } from '@/lib/db';

// GET  → the current user's org + wallets + vendors + members (dashboard payload)
// POST → create a self-serve org (one org per user in v1)
export const GET = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return json({ org: null, wallets: [], vendors: [], members: [], myRole: null });

  const [walletList, vendorList, memberList] = await Promise.all([
    (await wallets()).find({ orgId: m.org._id }).sort({ createdAt: 1 }).toArray(),
    (await vendors()).find({ orgId: m.org._id }).sort({ createdAt: 1 }).toArray(),
    (await members()).find({ orgId: m.org._id }).sort({ createdAt: 1 }).toArray(),
  ]);

  // Backfill the owner's email (needed for approval-email notifications;
  // the owner row is created without a session email).
  const ownerRow = memberList.find((row) => row.role === 'owner' && !row.email);
  if (ownerRow) {
    try {
      const token = getBearerToken(req);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = (await privy().users().get({ id_token: token ?? '' })) as any;
      const email = String(user?.email?.address ?? '').toLowerCase();
      if (email) {
        await (await members()).updateOne({ _id: ownerRow._id }, { $set: { email } });
        ownerRow.email = email;
      }
    } catch {
      /* backfill is best-effort */
    }
  }

  return json({ org: m.org, wallets: walletList, vendors: vendorList, members: memberList, myRole: m.role });
});

export const POST = withAuth(async (req, userId) => {
  const existing = await resolveMembershipForUser(userId);
  if (existing) return apiError('You already belong to an organization', 409);

  const body = await req.json();
  const name = String(body?.name ?? '').trim().slice(0, 100);
  if (!name) return apiError('Organization name is required');

  const created = await createOrgForUser(userId, { name });
  return json({ org: created.org, wallets: created.wallets }, 201);
});
