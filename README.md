# ◆ PayPilot

**Your money autopilot — flying inside policy, not trust.**

Built for the **Privy — Best B2B financial product** ($2,500 category).

PayPilot is a multi-tenant B2B platform where every organization gets real
self-custodial wallets on Base Sepolia — Treasury, Payroll, Bug Bounty
Rewards, whatever they need — each with its own spending policy, governed by
a 2-of-2 key quorum: the org admin (human) + PolicyBot (an app-held key that
co-signs only after re-checking the policy). Every payout is a Privy intent
that executes onchain only when the quorum threshold is met. On top of that
core, automation: scheduled/recurring sends, condition-triggered payments
and email-initiated flows — each scoped by policy.

- **Live:** https://pay-pilot-mu.vercel.app — sign in and create your org.
- **Network:** Base Sepolia (test USDC). Set `NEXT_PUBLIC_CHAIN=base` to run
  the identical flows on Base mainnet.

---

## Qualification requirements — how this project hits them

| Requirement | How TreasuryPilot delivers |
|---|---|
| **Integrate Privy as a core part of the product** | Auth (email login via `@privy-io/react-auth`), organizations, wallets, key quorums, policies, condition sets, intents and webhooks all run through Privy. The app DB is only a UI mirror — there is no app-side authority to compromise. |
| **Create or use at least one Privy wallet** | Every org gets 1–3+ real Privy organization wallets (`entity: {id, type: 'organization'}`), each with its own onchain address, created server-side via `@privy-io/node`. |
| **Demonstrate a business/organization use case** | Fictional **Acme Corp** (seeded demo) + self-serve org onboarding for anyone. Wallets are purpose-built: Treasury, Payroll, Bug Bounty Rewards — "one org, many purpose-built wallets, each with its own spending policy." |
| **≥1 functional B2B workflow** | **Payout flow:** request → policy pre-check → Privy intent on the org wallet → quorum approval → Privy executes the USDC transfer onchain → status/tx-hash recorded. Plus wallet administration (add named wallet + policy preset) and vendor onboarding (allowlist management). |
| **Use at least one Privy control** | **All four:** **key quorums** (2-of-2 admin + PolicyBot), **policies** (vendor allowlist via condition sets, per-tx caps via calldata decoding, chain + token lock-down — evaluated in Privy's enclave at signature time, default-deny), **signers** (authorization-key signatures from the browser + app-held key), **intents** (every payout is an async intent; Privy auto-executes at threshold). |
| **Working demo + source code** | Vercel deployment + this public repo. |
| **Clearly explain how Privy enables the product** | Section below + [PITCH.md](PITCH.md) + the landing page's "How Privy powers this" cards. |

---

## Roles & controls

Roles live in the app DB for UX; money-critical powers are enforced by Privy.

| Role | Can create payouts | Can approve | Other powers |
|---|---|---|---|
| **Owner** | ✅ | ✅ (quorum signer) | wallets, vendors, members, quorum updates |
| **Treasurer** | ✅ | ✅ (after owner adds them to the quorum) | — |
| **Finance Officer** | ✅ | ❌ (not a signer) | — |
| **Viewer** | ❌ | ❌ | read-only |

Invite flow: Owner invites by email → invitee logs in (Privy embedded auth)
and accepts → Owner clicks **Add to quorum** → the Privy key quorum is
updated with a **dual-control signature** (owner's session JWT + PolicyBot
key, satisfying 2-of-2) → the Treasurer becomes a real signer on every org
wallet. Approval semantics are 2-of-N: any two of {Owner, Treasurer, …,
PolicyBot} execute — PolicyBot always co-signs after its policy re-check, so
one human approval plus a passing policy completes a payout.

---

## How Privy enables this product

**Authority lives in Privy, not in our database.** If an attacker gets full
access to our app servers and MongoDB, they still cannot move a cent:
payouts are authorized by a Privy key quorum whose members are the admin's
Privy-managed key and PolicyBot's key; transfers are policy-checked by
Privy's enclave at signature time (allowlist, caps, chain, token — default
deny); and execution happens through Privy intents only.

**Dual control via a 2-of-2 quorum.** The org admin signs in the browser
(Privy authorization-key signature over the intent's request payload, via
`useAuthorizationSignature()`). PolicyBot — an app-held P-256 key registered
in the quorum — signs on the server, but only after re-checking the gates:
recipient in the vendor allowlist, amount within the wallet's cap. A human
decision plus an automated policy gate; neither side can move funds alone.

**Policies are enforcement, not decoration.** Each wallet's policy locks it
down to exactly one capability: `eth_sendTransaction` to the USDC contract,
on the configured chain, to an allowlisted recipient (Privy condition set),
at or under a decoded calldata cap. Everything else — other tokens, other
chains, key export — is denied by default, inside Privy's TEE.

**Intents make approvals asynchronous and auditable.** Payouts can be
requested while approvers are offline; Privy collects signatures, records
who signed when, and broadcasts the transaction automatically the moment the
threshold is met (gas sponsored). Webhooks + polling update the ledger.

---

## Try it live

1. https://pay-pilot-mu.vercel.app → **Create your organization** → sign in
   with your email (OTP) → name your org.
2. Invite teammates (Treasurer / Finance Officer / Viewer), add treasurers
   as quorum signers, set your approval tier + threshold in Team settings.
3. Onboard vendors → request a payout → approve → Privy broadcasts the USDC
   transfer on Base Sepolia → tx hash linked to the explorer.
4. **The fraud beat:** New payout → Custom address → paste any address →
   **DENIED BY POLICY** — the pre-check and the enclave policy stop it.
5. **Add wallet:** create any purpose-built wallet → new onchain address +
   its own policy preset in one click.

---

## Architecture

```
Browser (Privy embedded auth · useAuthorizationSignature)
   │  id token / approval signatures
   ▼
Next.js API routes (server-only; holds app secret + PolicyBot key)
   │  POST /api/orgs      → quorum → org → condition set → wallets+policies
   │  POST /api/wallets   → named wallet + policy preset
   │  POST /api/vendors   → DB row + condition-set allowlist item
   │  POST /api/payouts   → policy pre-check → intent (eth_sendTransaction USDC)
   │  POST /api/payouts/:id/approve → user sig → PolicyBot co-sig (gated)
   │  POST /api/webhooks/privy → intent.* events (polling is source of truth)
   ▼
Privy (orgs · wallets · key quorums · policies · condition sets · intents)
   ▼
MongoDB Atlas (orgs, wallets, vendors, payouts, activity — org-scoped)
```

### Stack

- **Next.js** (App Router) + TypeScript + Tailwind v4
- **Privy:** `@privy-io/node` (server) + `@privy-io/react-auth` (embedded auth)
- **MongoDB Atlas** via the official `mongodb` driver (every query org-scoped)
- **viem** (calldata encoding, dev-EOA funding, balance reads)
- **Base Sepolia** — gas sponsored by Privy on every intent

---

## Getting started

### 1. Privy app (free dev tier)

1. Create an app at https://dashboard.privy.io
2. Copy **App ID** and **App Secret**
3. Under *App settings → Networks*, enable **Base Sepolia**

### 2. MongoDB

Create a free Atlas cluster (or reuse one), then:

```bash
cp .env.example .env.local
# fill in MONGODB_URI, NEXT_PUBLIC_PRIVY_APP_ID, PRIVY_APP_SECRET
```

### 3. Keys + demo bank funding (one-time)

```bash
pnpm install
pnpm gen:keys          # prints POLICYBOT_PRIVATE_KEY + DEV_EOA_PRIVATE_KEY
```

- Paste both keys into `.env.local`.
- Fund the printed **dev EOA address** once with free test USDC at
  https://faucet.circle.com (Base Sepolia). This is the demo bank: it tops
  up the Acme demo treasury. Real orgs fund themselves via the in-app Fund
  screen. Without it the demo still works — the treasury just starts at $0.

### 4. Run

```bash
pnpm dev
```

Open http://localhost:3000 → **Try Acme Corp demo**.

### 5. Deploy (Vercel) + publish the repo

```bash
git remote add origin <your-github-repo-url>
git push -u origin main
vercel          # or push to GitHub and import the repo on vercel.com
```

Set the env vars in the Vercel dashboard (everything in `.env.example`).
Optionally register `https://<your-domain>/api/webhooks/privy` under
*Privy dashboard → Configuration → Webhooks* (topics: `intent.*`) and set
`PRIVY_WEBHOOK_SECRET`. The app polls intent status, so webhooks are a
fast-path, not a requirement.

---

## Project structure

```
app/                  pages + API routes
  page.tsx            landing + "Try Acme Corp demo"
  dashboard/          overview, payouts (list/new/approve), vendors, wallets, team
  api/                orgs, wallets, vendors, payouts, intents approve, activity, webhooks
lib/
  bootstrap.ts        quorum → org → condition set → wallets(+policies) → demo seed
  policy-presets.ts   policy builders (allowlist, caps, chain/token lock-down)
  intent-sign.ts      signature-payload construction + PolicyBot authorize
  payouts.ts          policy gates, intent lifecycle, status sync, demo funding
  bot-key.ts          P-256 PolicyBot key handling
  chain.ts            Base Sepolia / Base mainnet config
  db.ts               MongoDB access (org-scoped)
scripts/
  gen-keys.mjs        generate PolicyBot + dev EOA keys
  fund.mjs            send test USDC from the dev EOA to any address
```

## Roadmap (phase 2 — automation)

- **Scheduled/recurring sends** — "pay vendor X $500 every Monday" via
  Privy's wallet-automations API (`AttachWalletAutomationRequestBody`), with
  every run still gated by the wallet's policy + PolicyBot co-signature
- **Email-triggered flows** — Resend inbox → invoice parsed (LLM) → route to
  auto-pay or quorum escalation; spoofed-address invoices blocked at the
  policy layer (the fraud-beat, now automated)
- **Condition-based sends** — e.g. "pay when balance > X", "sweep idle USDC
  above buffer" — server conditions + PolicyBot as the enforcement gate
- Multi-human quorums (signed quorum updates when teammates join)
- Balance alerts, `intents().transfer` flow
