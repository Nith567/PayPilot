import { apiError, json, withAuth } from '@/lib/api-helpers';
import { resolveMembershipForUser } from '@/lib/authz';
import { wallets } from '@/lib/db';
import { walletUsdcBalance } from '@/lib/payouts';

// USDC balance of one org wallet, read onchain (RPC view call).
export const GET = withAuth(async (_req, userId, { params }) => {
  const { id } = await params;
  const m = await resolveMembershipForUser(userId);
  if (!m) return apiError('No organization', 404);

  const wallet = await (await wallets()).findOne({ _id: id, orgId: m.org._id });
  if (!wallet) return apiError('Wallet not found', 404);

  const balance = await walletUsdcBalance(wallet.address);
  return json({ balance });
});
