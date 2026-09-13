import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import canonicalize from 'canonicalize';
import { encodeFunctionData } from 'viem';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const auth = { Authorization: 'Basic ' + Buffer.from(`${APP_ID}:${process.env.PRIVY_APP_SECRET}`).toString('base64'), 'privy-app-id': APP_ID };
const WALLET = 'hiteh6hm01h503yvf7xq1pgo'; // ops wallet
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const RECIPIENT = '0x8879318091671ba1274e751f8cDEF76bb37eb3eD'; // hackquest vendor

// 1) wallet balance
const bal = await (await fetch(`https://api.privy.io/v1/wallets/${WALLET}/balance`, { headers: auth })).json();
console.log('wallet balance:', JSON.stringify(bal).slice(0, 400));

// 2) create a fresh intent (0.02 USDC)
const data = encodeFunctionData({
  abi: [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [
    { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }],
  functionName: 'transfer',
  args: [RECIPIENT, 20000n],
});
const rpcBody = {
  method: 'eth_sendTransaction',
  caip2: 'eip155:84532',
  sponsor: true,
  params: { transaction: { to: USDC, value: '0x0', data } },
};
const create = await fetch(`https://api.privy.io/v1/intents/wallets/${WALLET}/rpc`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(rpcBody),
});
const intent = await create.json();
console.log('intent created:', create.status, intent.intent_id, intent.status);

// 3) authorize with org signer key (exact Java-SDK payload)
const now = Date.now();
const payload = canonicalize({
  version: 1, method: 'POST',
  url: `https://api.privy.io/v1/wallets/${WALLET}/rpc`,
  body: rpcBody,
  headers: { 'privy-app-id': APP_ID, ...(intent.custom_expiry ? { 'privy-request-expiry': String(Math.trunc(intent.expires_at)) } : {}) },
  timestamp: now,
  intent_id: intent.intent_id,
});
const priv = createPrivateKey({ key: Buffer.from(process.env.ORG_SIGNER_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8' });
const sig = sign('sha256', Buffer.from(payload, 'utf8'), { key: priv, dsaEncoding: 'der' }).toString('base64');
const authRes = await fetch(`https://api.privy.io/v1/intents/${intent.intent_id}/authorize`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig, timestamp: now }),
});
console.log('authorize:', authRes.status, (await authRes.text()).slice(0, 150));

// 4) poll until terminal
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 2500));
  const got = await (await fetch(`https://api.privy.io/v1/intents/${intent.intent_id}`, { headers: auth })).json();
  if (['executed', 'failed', 'rejected', 'expired'].includes(got.status)) {
    console.log('final status:', got.status);
    console.log('action_result:', JSON.stringify(got.action_result));
    break;
  }
  console.log('poll', i + 1, ':', got.status);
}
