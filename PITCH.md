# PayPilot — Your money autopilot, flying inside policy

**Privy Sponsor · Best B2B financial product**

> Your finance team gets self-custodial org wallets where money authority
> lives inside Privy policy — not in a database someone can edit, or a Slack
> message someone can spoof. And automation that can actually move money —
> scheduled, conditional, email-triggered — scoped by that same policy.

## The problem

Onchain payments are final in seconds. Businesses still settle invoices by
copy-pasting an address from an email into a chat and signing a shared
wallet. Every guardrail lives in an app database — which is exactly what
attackers target. Invoice spoofing ("we changed our receiving wallet") is
irreversible the moment it clears.

## The product

- **One org, many purpose-built wallets** — Treasury, Payroll, Bug Bounty
  Rewards. Each is a real Privy organization wallet with its own policy.
- **Automation inside policy** — scheduled/recurring sends (Privy wallet
  automations), condition-triggered payments, and email-initiated flows —
  every automated move still passes the wallet's policy and PolicyBot's gate.
- **Payout flow** — request → policy pre-check → async intent → quorum →
  executed onchain, tx hash recorded.
- **2-of-2 key quorum** — the org admin (human, signs in-browser) +
  **PolicyBot** (app-held key, co-signs only after re-checking the policy).
- **Vendor allowlist as a Privy condition set** — onboarding a vendor makes
  their address policy-eligible instantly; no wallet updates, no quorum
  ceremony.

## How Privy enables it (the core pitch)

| Layer | Privy capability | What it buys |
|---|---|---|
| Custody | Organization wallets (`entity: organization`) | Self-custodial funds owned by the org's key quorum, never by the app |
| Governance | Key quorums (`authorization_threshold: 2`) | Dual control: human judgment + automated policy gate |
| Enforcement | Policies + condition sets, evaluated in the enclave at signature time | Allowlist, per-tx caps, chain and token lock-down. **Default deny.** Even a fully-compromised app server cannot move funds |
| Execution | Async intents + sponsored gas | Approvers sign from any device; Privy broadcasts automatically at threshold |
| Audit | Intent records + webhooks | Who signed, when, what executed — onchain and in the ledger |

## Demo beats (60s)

1. **Try Acme Corp demo** → seeded org: 3 wallets, vendors, funded treasury,
   payouts pending.
2. **Approve → executed** — browser signs, PolicyBot co-signs, USDC moves
   on Base Sepolia. Explorer link on screen.
3. **Fraud block** — pay a spoofed "changed" address → **DENIED BY POLICY**
   at three layers: pre-check, enclave policy, withheld co-signature.
4. **Add wallet** — new purpose, new address, new policy preset, one click.

## Why it wins

TreasuryPilot is the answer to "who can move company money, to whom, how
much, and who agreed" — enforced by cryptography and Privy's enclave rather
than by trust in a backend. It demos the full Privy stack (orgs, wallets,
quorums, policies, condition sets, intents, authorization signatures,
sponsored gas) inside one honest, 30-second business story.
