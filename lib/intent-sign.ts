import { formatRequestForAuthorizationSignature } from '@privy-io/node';
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

// The canonicalized bytes every approver signs — Privy's own formatter.
// The server base64s these to the browser; approvers sign with
// useAuthorizationSignature().
export function buildSignaturePayload(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body: Record<string, unknown>,
): Uint8Array {
  return formatRequestForAuthorizationSignature({
    version: 1,
    url,
    method,
    headers: { 'privy-app-id': requireEnv('NEXT_PUBLIC_PRIVY_APP_ID') },
    body,
  });
}

// Payout intents: the underlying wallet RPC request.
export function buildIntentSignaturePayload(
  walletId: string,
  rpcBody: Record<string, unknown>,
): Uint8Array {
  return buildSignaturePayload('POST', `${PRIVY_API_BASE}/v1/wallets/${walletId}/rpc`, rpcBody);
}

// Governance intents: the underlying key-quorum PATCH.
export function buildQuorumSignaturePayload(
  quorumId: string,
  body: Record<string, unknown>,
): Uint8Array {
  return buildSignaturePayload('PATCH', `${PRIVY_API_BASE}/v1/key_quorums/${quorumId}`, body);
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
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
