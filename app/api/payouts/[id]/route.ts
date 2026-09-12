import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { payouts, wallets } from '@/lib/db';
import { syncPayoutStatus } from '@/lib/payouts';
import { buildIntentSignaturePayload, buildUsdcTransferRpc, getIntent, toBase64 } from '@/lib/intent-sign';

// Payout detail: synced status + intent approval state + (while pending) the
// base64 signature payload the browser must sign with useAuthorizationSignature().
export const GET = withAuth(async (_req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);

  const payout = await (await payouts()).findOne({ _id: id, orgId: m.org._id });
  if (!payout) return apiError('Payout not found', 404);

  const fresh = await syncPayoutStatus(payout);

  let intent: Record<string, unknown> | null = null;
  let signaturePayloadBase64: string | null = null;

  if (fresh.intentId) {
    const raw = await getIntent(fresh.intentId);
    const details = raw?.authorization_details?.[0];
    intent = {
      status: raw?.status ?? 'pending',
      threshold: details?.threshold ?? null,
      members: (details?.members ?? []).map((m: { display_name?: string; type: string; signed_at?: number | null }) => ({
        name: m.display_name ?? m.type,
        type: m.type,
        signedAt: m.signed_at ?? null,
      })),
      expiresAt: raw?.expires_at ?? null,
    };

    if (fresh.status === 'pending') {
      const wallet = await (await wallets()).findOne({ _id: fresh.walletId });
      if (wallet) {
        const rpcBody = buildUsdcTransferRpc(fresh.recipient, fresh.amountUsdc);
        signaturePayloadBase64 = toBase64(buildIntentSignaturePayload(wallet._id, rpcBody));
      }
    }
  }

  return json({ payout: fresh, intent, signaturePayloadBase64 });
});
