import { privy } from './privy';
import { getOrgSignerPublicKeyBase64 } from './app-signer';
import { logActivity, members, newId, orgs, wallets } from './db';
import {
  DEFAULT_TIER_USD,
  POLICY_PRESETS,
  buildPayoutPolicy,
  capWeiHex,
  createConditionSet,
} from './policy-presets';
import type { OrgDoc, WalletDoc, WalletPurpose } from './types';

// Creates the whole Privy stack for a new organization:
//   main key quorum → ops key quorum → organization → condition set →
//   wallets (+policies), each main wallet owned by the main quorum and the
//   Ops wallet owned by the ops quorum.
//
// Quorums are human-only. Thresholds start at 1-of-N (the owner is the only
// member); as treasurers join, the owner raises the main quorum to 2-of-N in
// the approval settings — those governance changes are themselves quorum-
// approved once the threshold is above 1.

export async function createOrgForUser(
  userId: string,
  { name }: { name: string },
): Promise<{ org: OrgDoc; wallets: WalletDoc[] }> {
  // 1) Key quorums — main (governs Treasury etc.) + ops (governs small payouts).
  // Members: the org owner (human, RBAC-decides) + the app-held org signer
  // key (produces the intent authorization signatures). Threshold 1.
  const signerPublicKey = getOrgSignerPublicKeyBase64();
  const mainQuorum = await privy().keyQuorums().create({
    display_name: `${name} main quorum`,
    user_ids: [userId],
    public_keys: [signerPublicKey],
    authorization_threshold: 1,
  });
  const opsQuorum = await privy().keyQuorums().create({
    display_name: `${name} ops quorum`,
    user_ids: [userId],
    public_keys: [signerPublicKey],
    authorization_threshold: 1,
  });

  // 2) Organization
  const org = await privy().organizations().create({
    display_name: name,
    default_key_quorum_id: mainQuorum.id,
  });

  // 3) Vendor allowlist — one org-wide Privy condition set (name must be
  // unique per app, so the org id is part of the name)
  const conditionSetId = await createConditionSet(`${name} approved recipients`, org.id);

  // 4) Main wallets + policies (owned by the org's default key quorum)
  const purposes: WalletPurpose[] = ['treasury'];
  const createdWallets: WalletDoc[] = [];
  for (const purpose of purposes) {
    const preset = POLICY_PRESETS[purpose];
    const policy = await privy().policies().create(
      buildPayoutPolicy({
        name: `${name} ${preset.purpose}`.slice(0, 50),
        capWeiHex: capWeiHex(preset.capUsd),
        allowlistConditionSetId: conditionSetId,
      }),
    );
    const wallet = await privy().wallets().create({
      chain_type: 'ethereum',
      entity: { id: org.id, type: 'organization' },
      policy_ids: [policy.id],
      display_name: preset.purpose,
    });
    const walletDoc: WalletDoc = {
      _id: wallet.id,
      orgId: org.id,
      address: wallet.address,
      name: preset.purpose,
      purpose,
      policyId: policy.id,
      capUsd: preset.capUsd,
      createdAt: Date.now(),
    };
    await (await wallets()).insertOne(walletDoc);
    createdWallets.push(walletDoc);
  }

  // 5) Ops wallet — owned by the OPS quorum (1-of-N), policy cap = tier
  const opsPolicy = await privy().policies().create(
    buildPayoutPolicy({
      name: `${name} Ops small payouts`.slice(0, 50),
      capWeiHex: capWeiHex(DEFAULT_TIER_USD),
      allowlistConditionSetId: conditionSetId,
    }),
  );
  const opsWallet = await privy().wallets().create({
    chain_type: 'ethereum',
    entity: { id: org.id, type: 'organization' },
    owner_id: opsQuorum.id, // owned by the 1-of-N ops quorum, not the main one
    policy_ids: [opsPolicy.id],
    display_name: 'Ops · small payouts',
  });
  const opsWalletDoc: WalletDoc = {
    _id: opsWallet.id,
    orgId: org.id,
    address: opsWallet.address,
    name: 'Ops · small payouts',
    purpose: 'ops',
    policyId: opsPolicy.id,
    capUsd: DEFAULT_TIER_USD,
    createdAt: Date.now(),
  };
  await (await wallets()).insertOne(opsWalletDoc);
  createdWallets.push(opsWalletDoc);

  const orgDoc: OrgDoc = {
    _id: org.id,
    name,
    privyQuorumId: mainQuorum.id,
    opsQuorumId: opsQuorum.id,
    opsWalletId: opsWallet.id,
    ownerPrivyUserId: userId,
    conditionSetId,
    quorumThreshold: 1,
    tierAmountUsd: DEFAULT_TIER_USD,
    createdAt: Date.now(),
  };
  await (await orgs()).insertOne(orgDoc);
  await (await members()).insertOne({
    _id: newId(),
    orgId: org.id,
    privyUserId: userId,
    email: '', // owner row resolves by privyUserId; email comes from the session
    role: 'owner',
    status: 'active',
    inQuorum: true, // the owner is a member of both key quorums
    createdAt: Date.now(),
  });
  await logActivity({ orgId: org.id, type: 'org_created', message: `Organization "${name}" created` });

  return { org: orgDoc, wallets: createdWallets };
}
