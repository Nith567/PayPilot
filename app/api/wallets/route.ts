import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { privy } from '@/lib/privy';
import { logActivity, wallets } from '@/lib/db';
import {
  POLICY_PRESETS,
  buildPayoutPolicy,
  capWeiHex,
} from '@/lib/policy-presets';
import type { WalletDoc, WalletPurpose } from '@/lib/types';

export const GET = withAuth(async (_req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  const list = await (await wallets()).find({ orgId: m.org._id }).sort({ createdAt: 1 }).toArray();
  return json({ wallets: list });
});

// "Add wallet" — named, purpose-built wallet with its own Privy policy.
// Owner only: creating a wallet mints new spending authority.
export const POST = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'wallet:create');

  const body = await req.json();
  const name = String(body?.name ?? '').trim().slice(0, 100);
  const purpose = (String(body?.purpose ?? 'custom') as WalletPurpose) || 'custom';
  if (!name) return apiError('Wallet name is required');

  const count = await (await wallets()).countDocuments({ orgId: m.org._id });
  if (count >= 150) return apiError('Privy allows up to 150 wallets per organization', 400);

  const preset = POLICY_PRESETS[purpose] ?? POLICY_PRESETS.custom;

  const policy = await privy().policies().create(
    buildPayoutPolicy({
      name: `${m.org.name} ${name}`.slice(0, 50),
      capWeiHex: capWeiHex(preset.capUsd),
      allowlistConditionSetId: m.org.conditionSetId,
    }),
  );

  const wallet = await privy().wallets().create({
    chain_type: 'ethereum',
    entity: { id: m.org._id, type: 'organization' },
    policy_ids: [policy.id],
    display_name: name,
  });

  const doc: WalletDoc = {
    _id: wallet.id,
    orgId: m.org._id,
    address: wallet.address,
    name,
    purpose,
    policyId: policy.id,
    capUsd: preset.capUsd,
    createdAt: Date.now(),
  };
  await (await wallets()).insertOne(doc);
  await logActivity({
    orgId: m.org._id,
    type: 'wallet_created',
    message: `Wallet "${name}" created with its own Privy policy ($${preset.capUsd}/tx cap, vendor allowlist)`,
  });

  return json({ wallet: doc }, 201);
});
