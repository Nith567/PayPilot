import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { payouts, wallets } from '@/lib/db';
import { checkPolicyGates, syncPayoutStatus } from '@/lib/payouts';
import {
  authorizeIntentWithOrgSigner,
  getIntent,
  shouldOrgKeySign,
  submitUserSignature,
} from '@/lib/intent-sign';

// Approve a payout. The HUMAN decision: the caller must be an authenticated
// org member with an approve role. The SIGNATURE: the org's app-held
// authorization key (a quorum member) signs the intent's underlying request
// — authorization keys are the documented signer type for intent approval.
// Policy gates are re-checked before signing; Privy's enclave enforces the
// wallet policy again at execution.
export const POST = withAuth(async (_req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'payout:approve');

  const payout = await (await payouts()).findOne({ _id: id, orgId: m.org._id });
  if (!payout) return apiError('Payout not found', 404);
  if (!payout.intentId) return apiError('Payout has no pending intent', 400);
  if (payout.status !== 'pending') return apiError('Payout is not pending', 409);

  const wallet = await (await wallets()).findOne({ _id: payout.walletId, orgId: m.org._id });
  if (!wallet) return apiError('Wallet not found', 404);

  const gates = await checkPolicyGates(m.org._id, wallet, payout.recipient, payout.amountUsdc);
  if (!gates.ok) {
    await (await payouts()).updateOne(
      { _id: payout._id },
      { $set: { deniedReason: `Blocked by policy: ${gates.reason}` } },
    );
    return json(
      { payout: { ...payout, deniedReason: `Blocked by policy: ${gates.reason}` }, denied: true, reason: gates.reason },
      400,
    );
  }

  // The caller's embedded wallet may have produced a signature (threshold ≥ 2
  // with enough humans) — submit it first.
  const body = await _req.json().catch(() => ({}));
  const signature: string | undefined = body?.signature;
  const timestamp: number | undefined = body?.timestamp;
  if (signature && typeof timestamp === 'number') {
    await submitUserSignature(payout.intentId, signature, timestamp);
  }

  // The org signer key signs when a single signature suffices (threshold 1)
  // or when the humans alone can't reach the threshold.
  const intentBefore = await getIntent(payout.intentId);
  if (shouldOrgKeySign(intentBefore)) {
    await authorizeIntentWithOrgSigner(payout.intentId);
  }

  // Refresh signer state from Privy and sync execution status
  const freshIntent = await getIntent(payout.intentId);
  const signedNames: string[] = (freshIntent?.authorization_details?.[0]?.members ?? [])
    .filter((mem: { signed_at?: number | null }) => mem.signed_at)
    .map((mem: { display_name?: string; type: string }) => mem.display_name ?? mem.type);
  await (await payouts()).updateOne({ _id: payout._id }, { $set: { signedBy: signedNames } });

  const updated = await syncPayoutStatus(payout);

  return json({ payout: updated, signedBy: signedNames });
});
