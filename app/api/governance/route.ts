import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { governance } from '@/lib/db';
import { buildIntentBoundInput, getIntent, type IntentBoundSigningInput } from '@/lib/intent-sign';

// Pending + recent governance requests for the org (add-signer / threshold
// changes that need quorum approval).
export const GET = withAuth(async (_req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);

  const records = await (await governance())
    .find({ orgId: m.org._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  const bareUserId = userId.replace(/^did:privy:/, '');
  const withIntentState = await Promise.all(
    records.map(async (record) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const intent = (await getIntent(record.intentId)) as any;
        const details = intent?.authorization_details?.[0];
        const members = details?.members ?? [];
        let signatureInput: IntentBoundSigningInput | null = null;
        if (intent?.status === 'pending') {
          signatureInput = buildIntentBoundInput(intent);
        }
        return {
          ...record,
          intentStatus: intent?.status ?? 'pending',
          threshold: details?.threshold ?? null,
          members: members.map(
            (mem: { display_name?: string; type: string; signed_at?: number | null }) => ({
              name: mem.display_name ?? mem.type,
              signedAt: mem.signed_at ?? null,
            }),
          ),
          iSigned: members.some(
            (mem: { type: string; user_id?: string; signed_at?: number | null }) =>
              mem.type === 'user' &&
              (mem.user_id === userId || mem.user_id === bareUserId) &&
              mem.signed_at,
          ),
          signatureInput,
        };
      } catch {
        return {
          ...record,
          intentStatus: record.status,
          threshold: null,
          members: [],
          iSigned: false,
          signatureInput: null,
        };
      }
    }),
  );

  return json({ governance: withIntentState });
});
