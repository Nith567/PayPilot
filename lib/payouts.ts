import { createPublicClient, createWalletClient, http, erc20Abi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { privy } from './privy';
import { logActivity, newId, payouts, vendors, wallets } from './db';
import type { OrgDoc, PayoutDoc, WalletDoc } from './types';
import { buildUsdcTransferRpc, getIntent } from './intent-sign';
import { getChain, viemChain } from './chain';
import { optionalEnv } from './env';
import { DEFAULT_TIER_USD, capWeiHex } from './policy-presets';

// ── Policy gates (PolicyBot's side of dual control) ────────────────────────
// Before PolicyBot co-signs, it re-checks the org's policy in the app layer.
// The Privy policy on the wallet enforces the same rules at signature time,
// so a spoofed recipient or an over-cap amount is stopped twice.

export async function checkPolicyGates(
  orgId: string,
  wallet: WalletDoc,
  recipient: string,
  amountUsdc: number,
): Promise<{ ok: boolean; reason?: string }> {
  if (amountUsdc > wallet.capUsd) {
    return {
      ok: false,
      reason: `$${amountUsdc} exceeds this wallet's $${wallet.capUsd} per-transaction policy cap`,
    };
  }
  const vendorList = await (await vendors()).find({ orgId }).toArray();
  const allowlisted = vendorList.some(
    (v) => v.address.toLowerCase() === recipient.toLowerCase(),
  );
  if (!allowlisted) {
    return { ok: false, reason: 'recipient is not in the vendor allowlist' };
  }
  return { ok: true };
}

// ── Payout creation (shared by the manual route and the schedule tick) ──────

// Full request pipeline: amount-tier routing → policy gates → payout doc →
// Privy intent. Returns {denied, reason} for policy blocks instead of
// throwing, so callers (manual form, scheduler) can surface them.
export async function createOrgPayout(
  org: OrgDoc,
  opts: {
    recipient: string;
    amountUsdc: number;
    memo: string;
    walletId?: string;
    creatorName: string;
  },
): Promise<{ payout?: PayoutDoc; denied?: boolean; reason?: string }> {
  const tier = org.tierAmountUsd ?? DEFAULT_TIER_USD;

  // Amount-tiered routing: ≤ tier → Ops wallet (1-of-N); above → selected
  // main wallet. The Ops wallet's Privy policy cap enforces the tier.
  let wallet: WalletDoc | null = null;
  if (opts.walletId) {
    wallet = await (await wallets()).findOne({ _id: opts.walletId, orgId: org._id });
  }
  if (!wallet) {
    wallet = (await (await wallets()).findOne({ orgId: org._id, purpose: 'treasury' })) ?? null;
  }
  if (opts.amountUsdc <= tier && org.opsWalletId && wallet?._id !== org.opsWalletId) {
    const opsWallet = await (await wallets()).findOne({ _id: org.opsWalletId, orgId: org._id });
    if (opsWallet) wallet = opsWallet;
  }
  if (!wallet) return { denied: true, reason: 'No wallet available for this org' };

  const gates = await checkPolicyGates(org._id, wallet, opts.recipient, opts.amountUsdc);
  if (!gates.ok) return { denied: true, reason: gates.reason };

  const vendor = await (await vendors()).findOne({ orgId: org._id, address: opts.recipient });
  const payoutDoc: PayoutDoc = {
    _id: newId(),
    orgId: org._id,
    walletId: wallet._id,
    walletName: wallet.name,
    recipient: opts.recipient,
    vendorName: vendor?.name ?? null,
    amountUsdc: opts.amountUsdc,
    amountWei: capWeiHex(opts.amountUsdc),
    memo: opts.memo,
    intentId: null,
    status: 'pending',
    txHash: null,
    signedBy: [],
    deniedReason: null,
    creatorName: opts.creatorName,
    createdAt: Date.now(),
  };
  await (await payouts()).insertOne(payoutDoc);
  await createPayoutIntent(wallet, payoutDoc);
  await logActivity({
    orgId: org._id,
    type: 'payout_requested',
    message: `Payout requested by ${opts.creatorName}: $${opts.amountUsdc} → ${
      vendor?.name ?? opts.recipient.slice(0, 10) + '…'
    } (${wallet.name})`,
    payoutId: payoutDoc._id,
  });

  // Notify quorum signers by email (magic link to the approval screen).
  // Best-effort: notification failures never block the payout.
  try {
    const { sendPayoutApprovalEmails, signerEmailsForOrg } = await import('./email');
    const signers = await signerEmailsForOrg(org._id);
    void sendPayoutApprovalEmails(signers, {
      orgName: org.name,
      payoutId: payoutDoc._id,
      amountUsdc: opts.amountUsdc,
      vendorName: vendor?.name ?? opts.recipient.slice(0, 10) + '…',
      walletName: wallet.name,
    });
  } catch {
    /* notifications are best-effort */
  }
  return { payout: payoutDoc };
}

// ── Intent lifecycle ────────────────────────────────────────────────────────

export async function createPayoutIntent(
  wallet: WalletDoc,
  payout: PayoutDoc,
): Promise<string> {
  const rpcBody = buildUsdcTransferRpc(payout.recipient, payout.amountUsdc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intent = (await privy().intents().rpc(wallet._id, rpcBody as any)) as any;
  const intentId: string = intent.intent_id ?? intent.id;
  if (!intentId) throw new Error('Privy did not return an intent id');
  await (await payouts()).updateOne({ _id: payout._id }, { $set: { intentId } });
  return intentId;
}

// Map Privy intent status → app status, and pull the tx hash out of the
// execution result when present.
export async function syncPayoutStatus(payout: PayoutDoc): Promise<PayoutDoc> {
  if (!payout.intentId) return payout;
  const intent = await getIntent(payout.intentId);

  const privyStatus: string = intent?.status ?? 'pending';
  let status = payout.status;
  let txHash: string | null = payout.txHash;

  if (privyStatus === 'executed') {
    status = 'executed';
    txHash = extractTxHash(intent);
  } else if (['rejected', 'dismissed'].includes(privyStatus)) {
    status = 'denied';
  } else if (privyStatus === 'expired') {
    status = 'expired';
  } else if (privyStatus === 'failed') {
    status = 'failed';
    if (!payout.deniedReason) {
      await (await payouts()).updateOne(
        { _id: payout._id },
        { $set: { deniedReason: 'Privy rejected the transaction (policy or execution error)' } },
      );
    }
  }

  if (status !== payout.status || txHash !== payout.txHash) {
    await (await payouts()).updateOne(
      { _id: payout._id },
      { $set: { status, txHash } },
    );
    if (status === 'executed' && txHash) {
      await logActivity({
        orgId: payout.orgId,
        type: 'payout_executed',
        message: `$${payout.amountUsdc} USDC sent to ${payout.recipient.slice(0, 10)}… (${payout.walletName})`,
        txHash,
        payoutId: payout._id,
      });
    }
    return { ...payout, status, txHash };
  }
  return payout;
}

// Intent responses vary by type; extraction is defensive on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTxHash(intent: any): string | null {
  try {
    const body = intent?.action_result?.response_body;
    if (!body) return null;
    if (typeof body === 'string') return body.startsWith('0x') ? body : null;
    const match = JSON.stringify(body).match(/0x[a-fA-F0-9]{64}/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

// ── Demo funding ────────────────────────────────────────────────────────────
// The dev EOA ("demo bank") tops up freshly bootstrapped demo org wallets so
// payouts can execute onchain immediately. Regular orgs fund themselves via
// the in-app Fund screen. No-op when DEV_EOA_PRIVATE_KEY isn't configured.

export async function fundWalletFromDevEoa(
  recipient: string,
  amountUsdc: number,
): Promise<string | null> {
  const key = optionalEnv('DEV_EOA_PRIVATE_KEY');
  if (!key) return null;

  const chain = getChain();
  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: viemChain(),
    transport: http(chain.rpcUrl),
  });

  const hash = await client.writeContract({
    address: chain.usdcAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipient as `0x${string}`, parseUnits(String(amountUsdc), 6)],
  });
  return hash;
}

// ── Balance (RPC view call) ─────────────────────────────────────────────────

export async function walletUsdcBalance(address: string): Promise<number> {
  const chain = getChain();
  const client = createPublicClient({
    chain: viemChain(),
    transport: http(chain.rpcUrl),
  });
  const raw = (await client.readContract({
    address: chain.usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  })) as bigint;
  return Number(raw) / 1e6;
}
