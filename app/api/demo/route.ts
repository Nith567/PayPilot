import { json, withAuth } from '@/lib/api-helpers';
import { getOrgForUser } from '@/lib/orgs';
import { createOrgForUser, fundDemoTreasury, seedDemoData } from '@/lib/bootstrap';
import { payouts, wallets } from '@/lib/db';
import { walletUsdcBalance } from '@/lib/payouts';

// "Try Acme Corp demo" — boots the fictional Acme Corp for whoever is signed
// in (their Privy user becomes the admin). Idempotent and self-healing: if
// the org already exists (e.g. a previous bootstrap aborted part-way), it
// returns the org, finishes seeding whatever is missing, and re-attempts
// demo-bank funding whenever the treasury is dry (e.g. ETH was added to the
// dev EOA after a failed first attempt).
export const POST = withAuth(async (_req, userId) => {
  const existing = await getOrgForUser(userId);
  if (existing) {
    const walletList = await (await wallets()).find({ orgId: existing._id }).sort({ createdAt: 1 }).toArray();
    const payoutCount = await (await payouts()).countDocuments({ orgId: existing._id });
    if (payoutCount === 0) {
      await seedDemoData(existing, walletList);
    } else {
      const treasury = walletList.find((w) => w.purpose === 'treasury');
      if (treasury) {
        try {
          const balance = await walletUsdcBalance(treasury.address);
          if (balance < 5000) await fundDemoTreasury(existing, treasury);
        } catch {
          // balance read failed (RPC hiccup) — skip the funding retry
        }
      }
    }
    return json({ org: existing, wallets: walletList, already: true });
  }

  const created = await createOrgForUser(userId, { name: 'Acme Corp', demo: true });
  return json({ org: created.org, wallets: created.wallets, already: false });
});
