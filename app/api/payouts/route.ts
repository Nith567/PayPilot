import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { payouts, wallets } from '@/lib/db';
import { createOrgPayout } from '@/lib/payouts';
import { ROLE_LABELS } from '@/lib/types';

export const GET = withAuth(async (_req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  const list = await (await payouts()).find({ orgId: m.org._id }).sort({ createdAt: -1 }).toArray();
  return json({ payouts: list });
});

// Request a payout: policy pre-check → tier routing → Privy intent on the
// org wallet → pending quorum approval. Owner, Treasurer and Finance
// Officer may request; approval stays with Owner/Treasurer (quorum signers).
export const POST = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'payout:create');

  const body = await req.json();
  const walletId = String(body?.walletId ?? '');
  const recipient = String(body?.recipient ?? '').trim();
  const amountUsdc = Number(body?.amountUsdc);
  const memo = String(body?.memo ?? '').trim().slice(0, 280);

  if (!walletId || !recipient || !Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    return apiError('walletId, recipient and a positive amountUsdc are required');
  }

  const wallet = await (await wallets()).findOne({ _id: walletId, orgId: m.org._id });
  if (!wallet) return apiError('Wallet not found', 404);

  const result = await createOrgPayout(m.org, {
    recipient,
    amountUsdc,
    memo,
    walletId,
    creatorName: ROLE_LABELS[m.role],
  });
  if (result.denied) {
    return json({ denied: true, reason: result.reason }, 400);
  }

  return json({ payout: result.payout }, 201);
});
