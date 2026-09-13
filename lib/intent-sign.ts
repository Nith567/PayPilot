import canonicalize from 'canonicalize';
import { encodeFunctionData } from 'viem';
import { getChain } from './chain';
import { PRIVY_API_BASE, privyFetch } from './privy';
import { requireEnv } from './env';
import { orgSignerSignPayload } from './app-signer';

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
// — Privy's client hook canonicalizes it. The payload must match the
// intent's request_details EXACTLY ({version, method, url, body, headers} —
// no intent_id: adding one shifts the canonical bytes and Privy rejects
// with "Invalid signature for intent").
export interface SignatureInput {
  version: 1;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body: Record<string, unknown>;
  headers: { 'privy-app-id': string };
}

// Payout intents: the underlying wallet RPC request.
export function buildIntentSignatureInput(
  walletId: string,
  rpcBody: Record<string, unknown>,
): SignatureInput {
  return {
    version: 1,
    method: 'POST',
    url: `${PRIVY_API_BASE}/v1/wallets/${walletId}/rpc`,
    body: rpcBody,
    headers: { 'privy-app-id': requireEnv('NEXT_PUBLIC_PRIVY_APP_ID') },
  };
}

// Governance intents: the underlying key-quorum PATCH.
export function buildQuorumSignatureInput(
  quorumId: string,
  body: Record<string, unknown>,
): SignatureInput {
  return {
    version: 1,
    method: 'PATCH',
    url: `${PRIVY_API_BASE}/v1/key_quorums/${quorumId}`,
    body,
    headers: { 'privy-app-id': requireEnv('NEXT_PUBLIC_PRIVY_APP_ID') },
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
// Sign the intent's authorization server-side with the org signer key and
// submit it. The intent-approval payload binds the intent:
// canonicalize({version, method, url, headers, body, intent_id}) — the
// intent_id binding matches the client SDK's GenerateAuthorizationSignatureInput
// ("Intent ID binding this signature to a specific intent"). The app only
// signs after an authenticated org member with an approve role clicked and
// the policy gates passed.
export async function authorizeIntentWithOrgSigner(
  intentId: string,
  input: SignatureInput,
): Promise<void> {
  const payload = canonicalize({
    version: 1,
    method: input.method,
    url: input.url,
    headers: input.headers,
    body: input.body,
    intent_id: intentId,
  });
  if (!payload) throw new Error('Failed to canonicalize intent payload');
  const signature = orgSignerSignPayload(new TextEncoder().encode(payload));

  const res = await privyFetch(`/v1/intents/${intentId}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ signature, timestamp: Date.now() }),
  });
  if (!res.ok) {
    throw new Error(
      `Privy rejected the authorization: ${await res.text()}`,
    );
  }
}
