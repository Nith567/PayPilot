import { automations, logActivity, wallets } from './db';
import { createOrgPayout, walletUsdcBalance } from './payouts';
import type { OrgDoc } from './types';

// Condition-based automations: balance triggers that fire real actions
// through the SAME pipeline as manual requests — amount-tier routing, policy
// gates, Privy intents, quorum approval. "Automation gets authority; policy
// decides what it may do."

const COOLDOWN_MS = 6 * 3_600_000; // don't re-fire the same rule within 6h

export async function runDueAutomations(org: OrgDoc): Promise<number> {
  const rules = await (await automations())
    .find({ orgId: org._id, status: 'active' })
    .toArray();

  let fired = 0;
  for (const rule of rules) {
    if (rule.lastFiredAt && Date.now() - rule.lastFiredAt < COOLDOWN_MS) continue;

    const wallet = await (await wallets()).findOne({ _id: rule.walletId, orgId: org._id });
    if (!wallet) continue;

    let balance: number;
    try {
      balance = await walletUsdcBalance(wallet.address);
    } catch {
      continue; // RPC hiccup — skip this round
    }

    const conditionMet =
      rule.kind === 'balance_above' ? balance > rule.thresholdUsd : balance < rule.thresholdUsd;
    if (!conditionMet) continue;

    await (await automations()).updateOne(
      { _id: rule._id },
      { $set: { lastFiredAt: Date.now() } },
    );

    if (rule.actionType === 'send' && rule.recipient) {
      const sweepAmount =
        rule.amountUsdc ?? Math.max(0, balance - rule.thresholdUsd);
      if (sweepAmount <= 0) continue;
      const result = await createOrgPayout(org, {
        recipient: rule.recipient,
        amountUsdc: Math.round(sweepAmount * 100) / 100,
        memo: `[automation] ${rule.memo}`,
        creatorName: 'Automation',
      });
      if (result.denied) {
        await logActivity({
          orgId: org._id,
          type: 'payout_denied',
          message: `Automation blocked by policy: ${result.reason} (${rule.vendorName ?? rule.recipient.slice(0, 10)})`,
        });
      }
    } else {
      await logActivity({
        orgId: org._id,
        type: 'payout_requested',
        message: `Automation alert: ${wallet.name} balance is $${balance.toFixed(2)} (${rule.kind === 'balance_above' ? 'above' : 'below'} $${rule.thresholdUsd})`,
      });
    }
    fired++;
  }
  return fired;
}

export async function runAllDueAutomations(): Promise<number> {
  const { orgs } = await import('./db');
  const allOrgs = await (await orgs()).find({}).toArray();
  let fired = 0;
  for (const org of allOrgs) fired += await runDueAutomations(org);
  return fired;
}
