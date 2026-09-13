import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { payouts, wallets } from '@/lib/db';
import { privyFetch } from '@/lib/privy';
import { checkPolicyGates, syncPayoutStatus } from '@/lib/payouts';
import { getIntent } from '@/lib/intent-sign';

// Approve a payout: forwards the approver's browser-made authorization
// signature to Privy. When the quorum threshold is met, Privy executes the
// transfer automatically — and the wallet's policy (allowlist, caps, chain)
// is enforced at signature time, so a spoofed or over-cap payout is stopped
// even after every human has signed.
//
// App-layer gate: Owner/Treasurer may approve. Privy re-enforces: only
// key-quorum members can produce a valid intent signature.
export const POST = withAuth(async (req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'payout:approve');

  const payout = await (await payouts()).findOne({ _id: id, orgId: m.org._id });
  if (!payout) return apiError('Payout not found', 404);
  if (!payout.intentId) return apiError('Payout has no pending intent', 400);
  if (payout.status !== 'pending') return apiError('Payout is not pending', 409);

  const body = await req.json();
  const signature = String(body?.signature ?? '');
  const timestamp = body?.timestamp ? Number(body.timestamp) : Date.now();
  if (!signature) return apiError('Missing authorization signature');

  const intent = await getIntent(payout.intentId);
  const members: { user_id?: string; signed_at?: number | null }[] =
    intent?.authorization_details?.[0]?.members ?? [];
  // Privy reports intent members WITHOUT the did:privy: prefix while the
  // session token's sub carries it — normalize before comparing.
  const bareUserId = userId.replace(/^did:privy:/, '');
  const member = members.find(
    (mem) => mem.user_id === userId || mem.user_id === bareUserId,
  );
  if (!member) return apiError('You are not a signer on this payout', 403);
  if (member.signed_at) return apiError('You already signed this payout', 409);

  // Policy pre-check surfaced early: if the payout violates the org's rules
  // (spoofed recipient, over cap), refuse to forward the signature — the
  // Privy policy would deny it at execution anyway; this makes it visible.
  const wallet = await (await wallets()).findOne({ _id: payout.walletId, orgId: m.org._id });
  if (wallet) {
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
  }

  // Approver signature → Privy
  const res = await privyFetch(`/v1/intents/${payout.intentId}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ signature, timestamp }),
  });
  if (!res.ok) {
    return apiError(`Privy rejected the signature: ${await res.text()}`, 400);
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
