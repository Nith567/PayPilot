import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { privyFetch } from '@/lib/privy';
import { governance, members, orgs } from '@/lib/db';
import { getIntent } from '@/lib/intent-sign';
import type { GovernanceDoc } from '@/lib/types';

// A quorum member approves a governance request: their browser-made
// authorization signature is submitted to Privy's authorize endpoint. When
// the threshold is met, Privy applies the quorum mutation automatically —
// the route then syncs the app-side effects (member signer flag / stored
// threshold).
export const POST = withAuth(async (req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);

  const record = await (await governance()).findOne({ _id: id, orgId: m.org._id });
  if (!record) return apiError('Governance request not found', 404);
  if (record.status !== 'pending') return apiError('Request is not pending', 409);

  const body = await req.json();
  const signature = String(body?.signature ?? '');
  const timestamp = body?.timestamp ? Number(body.timestamp) : Date.now();
  if (!signature) return apiError('Missing authorization signature');

  const intent = await getIntent(record.intentId);
  const intentMembers: { user_id?: string; signed_at?: number | null }[] =
    intent?.authorization_details?.[0]?.members ?? [];
  // Same did:privy: prefix normalization as the payout approve route.
  const bareUserId = userId.replace(/^did:privy:/, '');
  if (!intentMembers.some((mem) => mem.user_id === userId || mem.user_id === bareUserId)) {
    return apiError('You are not a signer on this governance request', 403);
  }

  const res = await privyFetch(`/v1/intents/${record.intentId}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ signature, timestamp }),
  });
  if (!res.ok) {
    return apiError(`Privy rejected the signature: ${await res.text()}`, 400);
  }

  // Refresh intent state and apply app-side effects if executed
  const fresh = await getIntent(record.intentId);
  const intentStatus: string = fresh?.status ?? 'pending';
  const signedNames: string[] = (fresh?.authorization_details?.[0]?.members ?? [])
    .filter((mem: { signed_at?: number | null }) => mem.signed_at)
    .map((mem: { display_name?: string; type: string }) => mem.display_name ?? mem.type);

  let recordStatus: GovernanceDoc['status'] = record.status;
  if (intentStatus === 'executed') {
    recordStatus = 'executed';
    if (record.kind === 'add_signer') {
      const addedUserIds = (record.body.user_ids as string[]) ?? [];
      await (await members()).updateMany(
        { orgId: m.org._id, role: 'treasurer', privyUserId: { $in: addedUserIds } },
        { $set: { inQuorum: true } },
      );
    } else if (record.kind === 'set_threshold') {
      await (await orgs()).updateOne(
        { _id: m.org._id },
        { $set: { quorumThreshold: record.body.authorization_threshold as number } },
      );
    }
  } else if (['rejected', 'dismissed', 'expired'].includes(intentStatus)) {
    recordStatus = intentStatus === 'expired' ? 'expired' : 'denied';
  }
  if (recordStatus !== record.status) {
    await (await governance()).updateOne({ _id: record._id }, { $set: { status: recordStatus } });
  }

  return json({ governance: { ...record, status: recordStatus }, intentStatus, signedNames });
});
