import { privy } from './privy';
import { logActivity, members, newId, orgs, payouts, vendors, wallets } from './db';
import {
  DEFAULT_TIER_USD,
  POLICY_PRESETS,
  addConditionSetItems,
  allowlistValues,
  buildPayoutPolicy,
  capWeiHex,
  createConditionSet,
} from './policy-presets';
import { createPayoutIntent, fundWalletFromDevEoa } from './payouts';
import type { OrgDoc, PayoutDoc, WalletDoc, WalletPurpose } from './types';

// Fictional demo data — recognizable Hardhat test addresses, nothing real.
export const DEMO_VENDORS = [
  { name: 'Northwind Parts', address: '0x5FbDB2315678afecb367f032d93F642f64180aa3', email: 'ap@northwind.example' },
  { name: 'DevOps Dojo', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', email: 'billing@dojo.example' },
  { name: 'SecResearcher-42', address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', email: 'researcher42@security.example' },
];

const DEMO_PAYOUTS = [
  { walletPurpose: 'treasury' as WalletPurpose, vendorIndex: 0, amountUsdc: 1250, memo: 'Q3 parts order — PO-1042' },
  { walletPurpose: 'bug_bounty' as WalletPurpose, vendorIndex: 2, amountUsdc: 800, memo: 'Critical severity bounty payout' },
];

export interface CreateOrgOptions {
  name: string;
  demo?: boolean;
}

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
  { name, demo = false }: CreateOrgOptions,
): Promise<{ org: OrgDoc; wallets: WalletDoc[] }> {
  // 1) Key quorums — main (governs Treasury etc.) + ops (governs small payouts)
  const mainQuorum = await privy().keyQuorums().create({
    display_name: `${name} main quorum`,
    user_ids: [userId],
    authorization_threshold: 1, // owner alone until members join
  });
  const opsQuorum = await privy().keyQuorums().create({
    display_name: `${name} ops quorum`,
    user_ids: [userId],
    authorization_threshold: 1, // single approver for small payouts
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
  const purposes: WalletPurpose[] = demo
    ? ['treasury', 'payroll', 'bug_bounty']
    : ['treasury'];
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

  if (demo) {
    await seedDemoData(orgDoc, createdWallets);
  }

  return { org: orgDoc, wallets: createdWallets };
}

// Demo bank tops up the Treasury so payouts can execute onchain.
// Best-effort: without ETH on the dev EOA this fails — the demo continues
// with an unfunded (but fully functional) org and the activity feed says so.
// Retrying is safe (called whenever the demo route finds a dry treasury).
export async function fundDemoTreasury(org: OrgDoc, treasury: WalletDoc): Promise<void> {
  try {
    const fundHash = await fundWalletFromDevEoa(treasury.address, 5000);
    if (fundHash) {
      await logActivity({
        orgId: org._id,
        type: 'wallet_funded',
        message: `Treasury funded with 5,000 USDC (demo bank)`,
        txHash: fundHash,
      });
    }
  } catch (err) {
    await logActivity({
      orgId: org._id,
      type: 'wallet_funded',
      message: `Demo bank funding failed — dev EOA needs Base Sepolia ETH for gas (${
        err instanceof Error ? err.message.split('\n')[0] : 'unknown error'
      })`,
    });
  }
}

// Idempotent: safe to re-run on a partially bootstrapped org (e.g. after a
// failed demo bank transfer) — vendors are skipped if present, payouts are
// seeded only when none exist, and funding failure is non-fatal.
export async function seedDemoData(org: OrgDoc, walletList: WalletDoc[]): Promise<void> {
  // Vendors → Mongo + Privy condition set (both address cases)
  for (const v of DEMO_VENDORS) {
    // Mongo equality is case-sensitive — match either address form.
    const existing = await (await vendors()).findOne({
      orgId: org._id,
      $or: [{ address: v.address }, { address: v.address.toLowerCase() }],
    });
    if (existing) continue;
    await (await vendors()).insertOne({
      _id: newId(),
      orgId: org._id,
      name: v.name,
      address: v.address,
      email: v.email,
      createdAt: Date.now(),
    });
    await addConditionSetItems(org.conditionSetId, allowlistValues(v.address));
    await logActivity({ orgId: org._id, type: 'vendor_added', message: `Vendor onboarded: ${v.name}` });
  }

  // Demo bank tops up the Treasury (best-effort, see fundDemoTreasury)
  const treasury = walletList.find((w) => w.purpose === 'treasury')!;
  await fundDemoTreasury(org, treasury);

  // Two pending payouts awaiting quorum approval (only when none exist yet)
  const payoutCount = await (await payouts()).countDocuments({ orgId: org._id });
  if (payoutCount > 0) return;

  for (const seed of DEMO_PAYOUTS) {
    const wallet = walletList.find((w) => w.purpose === seed.walletPurpose)!;
    const vendor = DEMO_VENDORS[seed.vendorIndex];
    const payoutDoc: PayoutDoc = {
      _id: newId(),
      orgId: org._id,
      walletId: wallet._id,
      walletName: wallet.name,
      recipient: vendor.address,
      vendorName: vendor.name,
      amountUsdc: seed.amountUsdc,
      amountWei: capWeiHex(seed.amountUsdc),
      memo: seed.memo,
      intentId: null,
      status: 'pending',
      txHash: null,
      signedBy: [],
      deniedReason: null,
      creatorName: 'Finance Officer (demo)',
      createdAt: Date.now(),
    };
    await (await payouts()).insertOne(payoutDoc);
    await createPayoutIntent(wallet, payoutDoc);
    await logActivity({
      orgId: org._id,
      type: 'payout_requested',
      message: `Payout requested: $${seed.amountUsdc} → ${vendor.name} (${wallet.name})`,
      payoutId: payoutDoc._id,
    });
  }
}
