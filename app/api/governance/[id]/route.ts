import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { governance } from '@/lib/db';
import { buildQuorumSignatureInput } from '@/lib/intent-sign';

// Governance request detail: the structured signing input (the underlying
// key-quorum PATCH, intent-bound) for useAuthorizationSignature().
export const GET = withAuth(async (_req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);

  const record = await (await governance()).findOne({ _id: id, orgId: m.org._id });
  if (!record) return apiError('Governance request not found', 404);

  const signatureInput =
    record.status === 'pending'
      ? buildQuorumSignatureInput(record.quorumId, record.body)
      : null;

  return json({ governance: record, signatureInput });
});
