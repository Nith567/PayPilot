import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser, assertCan } from '@/lib/authz';
import { automations, logActivity, newId, vendors, wallets } from '@/lib/db';
import { ROLE_LABELS, type AutomationDoc } from '@/lib/types';

export const GET = withAuth(async (_req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  const list = await (await automations()).find({ orgId: m.org._id }).sort({ createdAt: -1 }).toArray();
  return json({ automations: list });
});

// Create a condition rule: "when wallet balance goes above/below $X, send
// to a vendor or notify". Sends go through the normal payout pipeline —
// policy gates apply at fire time.
export const POST = withAuth(async (req, userId) => {
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);
  assertCan(m.role, 'payout:create');

  const body = await req.json();
  const kind = String(body?.kind ?? '') as AutomationDoc['kind'];
  const walletId = String(body?.walletId ?? '');
  const thresholdUsd = Number(body?.thresholdUsd);
  const actionType = String(body?.actionType ?? 'notify') as AutomationDoc['actionType'];
  const recipient = String(body?.recipient ?? '').trim();
  const amountUsdc = body?.amountUsdc ? Number(body.amountUsdc) : null;
  const memo = String(body?.memo ?? '').trim().slice(0, 280);

  if (!['balance_above', 'balance_below'].includes(kind)) return apiError('kind must be balance_above or balance_below');
  if (!Number.isFinite(thresholdUsd) || thresholdUsd < 0) return apiError('thresholdUsd must be a non-negative number');

  const wallet = await (await wallets()).findOne({ _id: walletId, orgId: m.org._id });
  if (!wallet) return apiError('Wallet not found', 404);

  let vendorName: string | null = null;
  if (actionType === 'send') {
    if (kind === 'balance_below') return apiError('balance_below rules support notify only (sending on low balance makes no sense)');
    const vendor = await (await vendors()).findOne({ orgId: m.org._id, address: recipient });
    if (!vendor) return apiError('Send targets must be onboarded vendors (policy allowlist)');
    if (amountUsdc !== null && (!Number.isFinite(amountUsdc) || amountUsdc <= 0)) return apiError('amountUsdc must be positive');
    vendorName = vendor.name;
  }

  const doc: AutomationDoc = {
    _id: newId(),
    orgId: m.org._id,
    kind,
    walletId: wallet._id,
    walletName: wallet.name,
    thresholdUsd,
    actionType,
    recipient: actionType === 'send' ? recipient : null,
    vendorName,
    amountUsdc,
    memo,
    status: 'active',
    lastFiredAt: null,
    createdAt: Date.now(),
  };
  await (await automations()).insertOne(doc);
  await logActivity({
    orgId: m.org._id,
    type: 'payout_requested',
    message: `Automation created by ${ROLE_LABELS[m.role]}: ${wallet.name} ${kind === 'balance_above' ? 'above' : 'below'} $${thresholdUsd} → ${actionType === 'send' ? `send to ${vendorName}` : 'notify'}`,
  });

  return json({ automation: doc }, 201);
});
