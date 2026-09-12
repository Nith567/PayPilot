// Sends test USDC from the dev EOA to any address on Base Sepolia.
// Usage: pnpm fund <recipient> <amountUsdc>
// Used to top up the demo bank account itself or any org wallet while testing.
import { createWalletClient, http, erc20Abi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local — env may be set directly
}

const [recipient, amountUsdc] = process.argv.slice(2);
if (!recipient || !amountUsdc) {
  console.error('Usage: pnpm fund <recipient> <amountUsdc>');
  process.exit(1);
}

const key = process.env.DEV_EOA_PRIVATE_KEY;
if (!key) {
  console.error('Set DEV_EOA_PRIVATE_KEY in .env.local first.');
  process.exit(1);
}

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
});

const hash = await client.writeContract({
  address: USDC_BASE_SEPOLIA,
  abi: erc20Abi,
  functionName: 'transfer',
  args: [recipient, parseUnits(amountUsdc, 6)],
});

console.log(`Sent ${amountUsdc} test USDC → ${recipient}`);
console.log(`Tx: https://sepolia.basescan.org/tx/${hash}`);
