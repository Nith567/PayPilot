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
- **Automation inside policy** — scheduled/recurring sends, condition-triggered
  payments, and email-initiated flows — every automated move still passes the
  wallet's policy at signature time.
- **Payout flow** — request → policy pre-check → async intent → quorum →
  executed onchain, tx hash recorded.
- **Human key quorum** — owner + treasurers, owner-settable threshold, with an
  amount tier routing small payouts to a single-signer Ops wallet.
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

1. **Create org** → Treasury + Ops wallets with policies attached, quorum
   ready for the team.
2. **Approve → executed** — signers approve, threshold met, USDC moves on
   Base Sepolia. Explorer link on screen.
3. **Fraud block** — pay a spoofed "changed" address → **DENIED BY POLICY**
   at two layers: pre-check + enclave policy.
4. **Set your own rules** — amount tier, quorum threshold, signers —
   governance that itself requires quorum approval.

## Why it wins

TreasuryPilot is the answer to "who can move company money, to whom, how
much, and who agreed" — enforced by cryptography and Privy's enclave rather
than by trust in a backend. It demos the full Privy stack (orgs, wallets,
quorums, policies, condition sets, intents, authorization signatures,
sponsored gas) inside one honest, 30-second business story.
