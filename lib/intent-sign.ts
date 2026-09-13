import canonicalize from 'canonicalize';
import { encodeFunctionData } from 'viem';
import { getChain } from './chain';
import { privyFetch } from './privy';
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
    // Wallet-paid gas (sponsor: false): the org wallet pays gas from its own
    // ETH. Privy gas sponsorship additionally requires TEE execution mode —
    // with sponsor: true and sponsorship unavailable, execution hard-fails.
    // Set NEXT_PUBLIC_SPONSOR_GAS=true (and enable sponsorship in the Privy
    // dashboard) to switch back to sponsored gas.
    sponsor: process.env.NEXT_PUBLIC_SPONSOR_GAS === 'true',
    params: {
      transaction: {
        to: chain.usdcAddress,
        value: '0x0',
        data: usdcTransferCalldata(recipient, amountUsdc),
      },
    },
  };
}

// The structured input a browser signs with useAuthorizationSignature() for
// intent authorization — the full intent-bound payload minus the timestamp
// (the client adds a fresh timestamp right before signing and sends the same
// value to the authorize endpoint). Privy's hook canonicalizes every field
// present, so the shape must match the API's expected payload exactly.
export interface IntentBoundSigningInput {
  version: 1;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body: Record<string, unknown>;
  headers: { 'privy-app-id': string; 'privy-request-expiry'?: string };
  intent_id: string;
}

// Build the browser signing input from the intent's stored request_details —
// headers carry privy-request-expiry = expires_at when the intent has a
// custom expiry (mirrors Privy's own SDK construction).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildIntentBoundInput(intent: any): IntentBoundSigningInput {
  const rd = intent.request_details as {
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    body: Record<string, unknown>;
  };
  return {
    version: 1,
    method: rd.method,
    url: rd.url,
    body: rd.body,
    headers: {
      'privy-app-id': requireEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
      ...(intent.custom_expiry
        ? { 'privy-request-expiry': String(Math.trunc(intent.expires_at)) }
        : {}),
    },
    intent_id: intent.intent_id,
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

// Submit a browser-made user authorization signature (useAuthorizationSignature)
// to the intent authorize endpoint. The timestamp must equal the one embedded
// in the signed payload. One signature per call; Privy executes automatically
// once the quorum threshold is met.
export async function submitUserSignature(
  intentId: string,
  signature: string,
  timestamp: number,
): Promise<void> {
  const res = await privyFetch(`/v1/intents/${intentId}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ signature, timestamp }),
  });
  if (!res.ok) {
    throw new Error(
      `Privy rejected the signature: ${await res.text()}`,
    );
  }
}

// Whether the org signer key should sign this intent. It signs when a single
// signature suffices (threshold 1 — the Ops single-approver flow) or when the
// humans alone cannot reach the threshold (e.g. 2-of-2 with one human + the
// key). When enough humans exist to meet the threshold, only their
// embedded-wallet signatures count — that keeps multi-human approval honest.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shouldOrgKeySign(intent: any): boolean {
  const details = intent?.authorization_details?.[0];
  const members: { type: string; signed_at?: number | null }[] =
    details?.members ?? [];
  const threshold: number = details?.threshold ?? 1;
  const keySigned = members.some((m) => m.type === 'key' && m.signed_at);
  const humanCount = members.filter((m) => m.type === 'user').length;
  return !keySigned && (threshold === 1 || threshold > humanCount);
}

// Authorize an intent with the org signer key. The signed payload mirrors
// Privy's own SDK construction (PrivyIntentsService.authorize in the Java
// SDK): {version, method, url, body, headers, timestamp, intent_id} built
// from the intent's stored request_details — canonicalized, sha256, P-256
// DER. The timestamp is captured once and used in both the payload and the
// authorize body. headers include privy-request-expiry = expires_at when the
// intent has a custom expiry. The app only signs after an authenticated org
// member with an approve role clicked and the policy gates passed.
export async function authorizeIntentWithOrgSigner(intentId: string): Promise<void> {
  const intent = await getIntent(intentId);
  const rd = intent.request_details as { method: string; url: string; body: Record<string, unknown> };
  const now = Date.now();
  const payload = canonicalize({
    version: 1,
    method: rd.method,
    url: rd.url,
    body: rd.body,
    headers: {
      'privy-app-id': requireEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
      ...(intent.custom_expiry
        ? { 'privy-request-expiry': String(Math.trunc(intent.expires_at)) }
        : {}),
    },
    timestamp: now,
    intent_id: intentId,
  });
  if (!payload) throw new Error('Failed to canonicalize intent payload');
  const signature = orgSignerSignPayload(new TextEncoder().encode(payload));

  const res = await privyFetch(`/v1/intents/${intentId}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ signature, timestamp: now }),
  });
  if (!res.ok) {
    throw new Error(
      `Privy rejected the authorization: ${await res.text()}`,
    );
  }
}
