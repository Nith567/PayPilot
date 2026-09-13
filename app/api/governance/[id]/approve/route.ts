import { apiError, json, withAuth } from '@/lib/api-helpers';
import { getBearerToken } from '@/lib/auth';
import { resolveMembershipForUser } from '@/lib/authz';
import { governance, members, orgs } from '@/lib/db';
import { getIntent, submitUserAuthorization } from '@/lib/intent-sign';
import type { GovernanceDoc } from '@/lib/types';

// A quorum member approves a governance request. Signing is server-side:
// the SDK exchanges the approver's JWT for a fresh user signing key,
// constructs the authorization signature and submits it. When the threshold
// is met, Privy applies the quorum mutation — the route then syncs the
// app-side effects (member signer flag / stored threshold).
export const POST = withAuth(async (req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);

  const record = await (await governance()).findOne({ _id: id, orgId: m.org._id });
  if (!record) return apiError('Governance request not found', 404);
  if (record.status !== 'pending') return apiError('Request is not pending', 409);

  const token = getBearerToken(req);
  if (!token) return apiError('Missing session token', 401);
  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  if (!origin) return apiError('Missing origin header', 400);

  const intent = await getIntent(record.intentId);
  const intentMembers: { user_id?: string; signed_at?: number | null }[] =
    intent?.authorization_details?.[0]?.members ?? [];
  // Same did:privy: prefix normalization as the payout approve route.
  const bareUserId = userId.replace(/^did:privy:/, '');
  if (!intentMembers.some((mem) => mem.user_id === userId || mem.user_id === bareUserId)) {
    return apiError('You are not a signer on this governance request', 403);
  }

  // Forward the user's access token — Privy derives their signing key and
  // records the authorization (the "wallet owner via user token" path).
  await submitUserAuthorization(record.intentId, token, origin);

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
