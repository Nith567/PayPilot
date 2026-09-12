import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { governance } from '@/lib/db';
import { getIntent } from '@/lib/intent-sign';

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

  const withIntentState = await Promise.all(
    records.map(async (record) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const intent = (await getIntent(record.intentId)) as any;
        const details = intent?.authorization_details?.[0];
        return {
          ...record,
          intentStatus: intent?.status ?? 'pending',
          threshold: details?.threshold ?? null,
          members: (details?.members ?? []).map(
            (mem: { display_name?: string; type: string; signed_at?: number | null }) => ({
              name: mem.display_name ?? mem.type,
              signedAt: mem.signed_at ?? null,
            }),
          ),
        };
      } catch {
        return { ...record, intentStatus: record.status, threshold: null, members: [] };
      }
    }),
  );

  return json({ governance: withIntentState });
});
