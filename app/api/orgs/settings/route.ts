import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { logActivity, orgs, wallets } from '@/lib/db';
import { updatePolicyCap } from '@/lib/policy-presets';

// Owner updates the amount tier: payouts ≤ tierAmountUsd route to the Ops
// wallet (single approver, 1-of-N); above it, the main wallets' quorum
// applies. The Ops wallet's Privy policy cap is updated to match — so the
// tier is enforced at signature time, not just in app routing.
export const POST = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'member:manage');

  const body = await req.json();
  const tier = Number(body?.tierAmountUsd);
  if (!Number.isFinite(tier) || tier < 1 || tier > 10000) {
    return apiError('tierAmountUsd must be between 1 and 10,000');
  }

  const opsWallet = await (await wallets()).findOne({ _id: m.org.opsWalletId, orgId: m.org._id });
  if (opsWallet?.policyId) {
    await updatePolicyCap(opsWallet.policyId, `${m.org.name} Ops small payouts`, tier, m.org.conditionSetId);
    await (await wallets()).updateOne({ _id: opsWallet._id }, { $set: { capUsd: tier } });
  }

  await (await orgs()).updateOne({ _id: m.org._id }, { $set: { tierAmountUsd: tier } });
  await logActivity({
    orgId: m.org._id,
    type: 'settings_updated',
    message: `Approval tier set to $${tier} — payouts ≤ $${tier} go through the Ops wallet (single approver)`,
  });

  return json({ org: { ...m.org, tierAmountUsd: tier } });
});
