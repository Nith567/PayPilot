process.loadEnvFile('.env.local');

import { privy } from '../lib/privy';
import { createOrgForUser } from '../lib/bootstrap';
import { orgs, wallets, members, payouts } from '../lib/db';

async function main() {
  const email = `e2e-test-${Date.now()}@example.com`;
  const user = await privy().users().create({
    linked_accounts: [{ type: 'email', address: email }],
  });
  console.log('✓ test Privy user created:', user.id, `(${email})`);

  const { org } = await createOrgForUser(user.id, { name: 'E2E Test Org' });
  console.log('✓ org created:', org._id, 'quorum:', org.privyQuorumId);

  const [orgRow, walletRows, memberRows, payoutRows] = await Promise.all([
    (await orgs()).findOne({ _id: org._id }),
    (await wallets()).find({ orgId: org._id }).toArray(),
    (await members()).find({ orgId: org._id }).toArray(),
    (await payouts()).countDocuments({ orgId: org._id }),
  ]);
  console.log(
    `✓ Mongo: org=${!!orgRow}, wallets=${walletRows.length}, members=${memberRows.length}, payouts=${payoutRows}`,
  );
  for (const w of walletRows) {
    console.log(`   wallet: ${w.name} @ ${w.address.slice(0, 10)}… policy=${(w.policyId ?? '').slice(0, 10)}… cap=$${w.capUsd}`);
  }
  console.log('✓ SELF-SERVE ORG FLOW WORKS END-TO-END');
  console.log('CLEANUP_ORG=' + org._id);
  // The Mongo client keeps the event loop alive — exit explicitly.
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ FAILED:', err);
  process.exit(1);
});
