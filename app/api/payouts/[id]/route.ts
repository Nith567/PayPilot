import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { payouts } from '@/lib/db';
import { syncPayoutStatus } from '@/lib/payouts';
import { buildIntentBoundInput, getIntent, type IntentBoundSigningInput } from '@/lib/intent-sign';

// Payout detail: synced status + intent approval state + (while pending) the
// structured signing input the browser passes to useAuthorizationSignature().
export const GET = withAuth(async (_req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);

  const payout = await (await payouts()).findOne({ _id: id, orgId: m.org._id });
  if (!payout) return apiError('Payout not found', 404);

  const fresh = await syncPayoutStatus(payout);

  let intent: Record<string, unknown> | null = null;
  let signatureInput: IntentBoundSigningInput | null = null;

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
      customExpiry: raw?.custom_expiry ?? false,
    };

    if (fresh.status === 'pending') {
      signatureInput = buildIntentBoundInput(raw);
    }
  }

  return json({ payout: fresh, intent, signatureInput });
});
