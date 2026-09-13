import { generateAuthorizationSignatures } from '@privy-io/node';
import { encodeFunctionData } from 'viem';
import { getChain } from './chain';
import { PRIVY_API_BASE, privy, privyFetch } from './privy';
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

// Approve an intent on behalf of the signed-in user, entirely server-side.
// The SDK exchanges the user's IDENTITY token for a fresh user signing key
// (the /wallets/authenticate flow) and constructs the authorization
// signature — the documented robust path for user-type quorum members.
export async function authorizeIntentForUser(
  identityToken: string,
  intentId: string,
  input: SignatureInput,
): Promise<void> {
  const [signature] = await generateAuthorizationSignatures(privy(), {
    authorizationContext: { user_jwts: [identityToken] },
    input: {
      version: 1,
      method: input.method,
      url: input.url,
      body: input.body,
      headers: input.headers,
      // Bind the signature to this intent (client input type documents it;
      // the node SDK type omits it — Privy accepts it in the payload).
      intent_id: input.intent_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  const res = await privyFetch(`/v1/intents/${intentId}/authorize`, {
    method: 'POST',
    body: JSON.stringify({ signature, timestamp: Date.now() }),
  });
  if (!res.ok) {
    throw new Error(
      `authorizeIntentForUser failed: ${res.status} ${await res.text()}`,
    );
  }
}
