import { encodeFunctionData } from 'viem';
import { getChain } from './chain';
import { PRIVY_API_BASE, privyFetch } from './privy';
import { requireEnv } from './env';

// USDC transfer() — used for calldata encoding and by the policy's
// ethereum_calldata conditions (the policy decodes args against this ABI).
export const USDC_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export function usdcTransferCalldata(
  recipient: string,
  amountUsdc: number,
): `0x${string}` {
  return encodeFunctionData({
    abi: USDC_TRANSFER_ABI,
    functionName: 'transfer',
    args: [recipient as `0x${string}`, BigInt(Math.round(amountUsdc * 1e6))],
  });
}

// The RPC body that becomes an intent on the org wallet. This exact object is
// both (a) sent to create the intent and (b) serialized into the signature
// payload every approver signs — so it must stay deterministic.
export function buildUsdcTransferRpc(recipient: string, amountUsdc: number) {
  const chain = getChain();
  return {
    method: 'eth_sendTransaction',
    caip2: chain.caip2,
    sponsor: true, // gas sponsored — the org wallet needs no ETH
    params: {
      transaction: {
        to: chain.usdcAddress,
        value: '0x0',
        data: usdcTransferCalldata(recipient, amountUsdc),
      },
    },
  };
}

// The structured signing input every approver signs. Approvers pass this
// object directly to useAuthorizationSignature().generateAuthorizationSignature()
// — Privy's client hook canonicalizes it. The intent_id binding is REQUIRED:
// without it, Privy cannot map the signature to a valid authorization key
// ("No valid authorization key found for signature").
export interface SignatureInput {
  version: 1;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body: Record<string, unknown>;
  headers: { 'privy-app-id': string };
  intent_id: string;
}

// Payout intents: the underlying wallet RPC request.
export function buildIntentSignatureInput(
  walletId: string,
  intentId: string,
  rpcBody: Record<string, unknown>,
): SignatureInput {
  return {
    version: 1,
    method: 'POST',
    url: `${PRIVY_API_BASE}/v1/wallets/${walletId}/rpc`,
    body: rpcBody,
    headers: { 'privy-app-id': requireEnv('NEXT_PUBLIC_PRIVY_APP_ID') },
    intent_id: intentId,
  };
}

// Governance intents: the underlying key-quorum PATCH.
export function buildQuorumSignatureInput(
  quorumId: string,
  intentId: string,
  body: Record<string, unknown>,
): SignatureInput {
  return {
    version: 1,
    method: 'PATCH',
    url: `${PRIVY_API_BASE}/v1/key_quorums/${quorumId}`,
    body,
    headers: { 'privy-app-id': requireEnv('NEXT_PUBLIC_PRIVY_APP_ID') },
    intent_id: intentId,
  };
}

// Fetch an intent by id. The node SDK has intent *creators* (rpc, updateKeyQuorum,
// …) but no getter — this is a REST call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getIntent(intentId: string): Promise<any> {
  const res = await privyFetch(`/v1/intents/${intentId}`);
  if (!res.ok) {
    throw new Error(`getIntent failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Submit a browser-made authorization signature (useAuthorizationSignature)
// to the intent authorize endpoint. One signature per call; Privy executes
// automatically once the quorum threshold is met.
export async function submitUserSignature(
  intentId: string,
  signature: string,
): Promise<void> {
  const res = await privyFetch(`/v1/intents/${intentId}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ signature, timestamp: Date.now() }),
  });
  if (!res.ok) {
    throw new Error(
      `Privy rejected the signature: ${await res.text()}`,
    );
  }
}

// Authorize an intent by forwarding the USER'S access token to Privy —
// the endpoint is "callable by the wallet owner (via user token)", in which
// case Privy derives the user's signing key automatically (the SDK behavior
// the docs describe as automatic signature headers). This avoids the manual
// authorization-signature path entirely.
export async function submitUserAuthorization(
  intentId: string,
  userAccessToken: string,
  origin: string,
  signature: string,
): Promise<void> {
  const res = await fetch(`${PRIVY_API_BASE}/v1/intents/${intentId}/authorize`, {
    method: 'POST',
    headers: {
      'privy-app-id': requireEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
      // Required for user-authenticated calls (CSRF protection) — must
      // match an allowed domain in the Privy dashboard.
      Origin: origin,
    },
    body: JSON.stringify({ signature, timestamp: Date.now() }),
  });
  if (!res.ok) {
    throw new Error(
      `Privy rejected the authorization: ${await res.text()}`,
    );
  }
}
