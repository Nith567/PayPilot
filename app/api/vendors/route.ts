import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { logActivity, newId, vendors } from '@/lib/db';
import { addConditionSetItems, allowlistValues } from '@/lib/policy-presets';

export const GET = withAuth(async (_req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  const list = await (await vendors()).find({ orgId: m.org._id }).sort({ createdAt: 1 }).toArray();
  return json({ vendors: list });
});

// Onboard a vendor: Mongo record + Privy condition-set allowlist entry.
// Owner only — the allowlist is what the wallet policies enforce at
// signature time, so this is a money-critical action.
export const POST = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'vendor:write');

  const body = await req.json();
  const name = String(body?.name ?? '').trim().slice(0, 100);
  const address = String(body?.address ?? '').trim();
  const email = body?.email ? String(body.email).trim().slice(0, 254) : undefined;

  if (!name) return apiError('Vendor name is required');
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return apiError('Address must be a 0x-prefixed, 40-hex-character EVM address');

  // Mongo equality is case-sensitive — match either address form.
  const existing = await (await vendors()).findOne({
    orgId: m.org._id,
    $or: [{ address }, { address: address.toLowerCase() }],
  });
  if (existing) return apiError('That address is already an onboarded vendor', 409);

  const doc = {
    _id: newId(),
    orgId: m.org._id,
    name,
    address,
    email,
    createdAt: Date.now(),
  };
  await (await vendors()).insertOne(doc);
  await addConditionSetItems(m.org.conditionSetId, allowlistValues(address));
  await logActivity({
    orgId: m.org._id,
    type: 'vendor_added',
    message: `Vendor onboarded: ${name} — added to the Privy policy allowlist`,
  });

  return json({ vendor: doc }, 201);
});
