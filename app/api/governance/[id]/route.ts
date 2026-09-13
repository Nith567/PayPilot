import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { governance } from '@/lib/db';
import { buildIntentBoundInput, getIntent, type IntentBoundSigningInput } from '@/lib/intent-sign';

// Governance request detail: the structured signing input (the underlying
// key-quorum PATCH, intent-bound) for useAuthorizationSignature().
export const GET = withAuth(async (_req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);

  const record = await (await governance()).findOne({ _id: id, orgId: m.org._id });
  if (!record) return apiError('Governance request not found', 404);

  let signatureInput: IntentBoundSigningInput | null = null;
  if (record.status === 'pending' && record.intentId) {
    signatureInput = buildIntentBoundInput(await getIntent(record.intentId));
  }

  return json({ governance: record, signatureInput });
});
