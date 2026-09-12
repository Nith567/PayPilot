import { NotFoundError, privy } from './privy';

// Pregenerate an employee's Privy user + embedded wallet from their email
// (Privy docs recipe "pregenerate-wallets"). When the invitee later logs in
// with that email, Privy links the login to this pregenerated user and the
// wallet is already there — no first-login setup, assets can even be sent
// before they ever sign in.
export async function ensurePregeneratedUser(
  email: string,
): Promise<{ userId: string; pregenerated: boolean }> {
  try {
    const existing = await privy().users().getByEmailAddress({ address: email });
    // Account already exists (they've used Privy before) — their wallet from
    // their own login is theirs to keep; nothing to pregenerate.
    return { userId: existing.id, pregenerated: false };
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }

  const user = await privy().users().create({
    linked_accounts: [{ type: 'email', address: email }],
    wallets: [{ chain_type: 'ethereum' }],
  });
  return { userId: user.id, pregenerated: true };
}
