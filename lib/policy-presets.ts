import { getChain } from './chain';
import { privy, privyFetch } from './privy';
import { USDC_TRANSFER_ABI } from './intent-sign';

// Default amount tier: payouts ≤ this route to the Ops wallet (single
// approver suffices); above it, the main wallets' quorum applies.
export const DEFAULT_TIER_USD = 300;

// Policy presets per wallet purpose. Every policy locks a wallet down to
// exactly one capability: sending USDC on the configured chain, to an
// allowlisted recipient, up to the wallet's cap. Privy evaluates these rules
// inside its enclave at signature time — default is DENY for anything else,
// including private-key export and any other method.

export interface WalletPolicyPreset {
  purpose: string;
  capUsd: number;
}

export const POLICY_PRESETS: Record<string, WalletPolicyPreset> = {
  treasury: { purpose: 'Treasury', capUsd: 10000 },
  payroll: { purpose: 'Payroll', capUsd: 2000 },
  bug_bounty: { purpose: 'Bug Bounty Rewards', capUsd: 5000 },
  ops: { purpose: 'Ops', capUsd: 1000 },
  custom: { purpose: 'Custom', capUsd: 500 },
};

export interface PayoutPolicyInput {
  name: string;
  capWeiHex: string;
  allowlistConditionSetId: string;
}

// Mirrors @privy-io/node's PolicyCreateParams with literal types so the
// result is assignable to the SDK's create() without casts.
export type PayoutPolicy = {
  version: '1.0';
  name: string;
  chain_type: 'ethereum';
  rules: {
    name: string;
    method: 'eth_sendTransaction';
    conditions: (
      | {
          field_source: 'ethereum_transaction';
          field: 'to' | 'value' | 'chain_id';
          operator: 'eq';
          value: string;
        }
      | {
          field_source: 'ethereum_calldata';
          field: string;
          operator: 'lte' | 'in_condition_set';
          abi: typeof USDC_TRANSFER_ABI;
          value: string;
        }
    )[];
    action: 'ALLOW';
  }[];
};

export function buildPayoutPolicy({
  name,
  capWeiHex,
  allowlistConditionSetId,
}: PayoutPolicyInput): PayoutPolicy {
  const chain = getChain();
  return {
    version: '1.0',
    name, // ≤ 50 chars
    chain_type: 'ethereum',
    rules: [
      {
        name: 'Allow USDC payouts within policy',
        method: 'eth_sendTransaction',
        conditions: [
          // Only the configured chain
          {
            field_source: 'ethereum_transaction',
            field: 'chain_id',
            operator: 'eq',
            value: String(chain.chainId),
          },
          // Only the USDC contract (no native ETH, no other tokens)
          {
            field_source: 'ethereum_transaction',
            field: 'to',
            operator: 'eq',
            value: chain.usdcAddress,
          },
          // Per-transaction cap, decoded from the transfer() calldata
          {
            field_source: 'ethereum_calldata',
            field: 'transfer.amount',
            abi: USDC_TRANSFER_ABI,
            operator: 'lte',
            value: capWeiHex,
          },
          // Recipient must be in the vendor allowlist (condition set).
          // Calldata comparisons are case-sensitive in some paths, so the
          // condition set is populated with both checksummed and lowercase
          // forms of every vendor address.
          {
            field_source: 'ethereum_calldata',
            field: 'transfer.recipient',
            abi: USDC_TRANSFER_ABI,
            operator: 'in_condition_set',
            value: allowlistConditionSetId,
          },
        ],
        action: 'ALLOW',
      },
    ],
  };
}

export function capWeiHex(capUsd: number): string {
  return `0x${BigInt(Math.round(capUsd * 1e6)).toString(16)}`;
}

// Rebuild a wallet's policy with a new cap (policies are owner-less, so the
// app secret alone can update them — no quorum ceremony). Privy's PATCH only
// accepts `name` + `rules` — version/chain_type are create-only.
export async function updatePolicyCap(
  policyId: string,
  name: string,
  capUsd: number,
  allowlistConditionSetId: string,
): Promise<void> {
  const built = buildPayoutPolicy({
    name: name.slice(0, 50),
    capWeiHex: capWeiHex(capUsd),
    allowlistConditionSetId,
  });
  await privy().policies().update(policyId, {
    name: built.name,
    rules: built.rules,
  });
}

// ── Vendor allowlist (Privy condition sets) ────────────────────────────────
// Condition sets are app-secret-managed (no owner), so adding/removing a
// vendor never requires a quorum signature or a wallet update.

export async function createConditionSet(name: string, uniqueSuffix?: string): Promise<string> {
  // Condition set names are unique PER APP — append the org id so two orgs
  // with the same display name (or a retried bootstrap) never collide.
  const safeName = uniqueSuffix ? `${name.slice(0, 50)} · ${uniqueSuffix}` : name;
  const res = await privyFetch('/v1/condition_sets', {
    method: 'POST',
    body: JSON.stringify({ name: safeName }),
  });
  if (!res.ok) throw new Error(`createConditionSet failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function addConditionSetItems(setId: string, values: string[]): Promise<void> {
  const res = await privyFetch(`/v1/condition_sets/${setId}/condition_set_items`, {
    method: 'POST',
    body: JSON.stringify(values.map((value) => ({ value }))),
  });
  if (!res.ok) {
    const text = await res.text();
    // Idempotency: re-adding values that are already in the set is a no-op
    // for the caller — Privy rejects with invalid_data "already exist".
    if (res.status === 400 && /already exist/i.test(text)) return;
    throw new Error(`addConditionSetItems failed: ${res.status} ${text}`);
  }
}

// Vendor addresses are stored checksummed; add both forms so the comparison
// succeeds regardless of case handling in the calldata extraction path.
export function allowlistValues(address: string): string[] {
  return [...new Set([address, address.toLowerCase()])];
}
