// Generates the demo bank account key. Run: pnpm gen:keys
//
//  DEV_EOA_PRIVATE_KEY — a normal Base Sepolia account used only to fund
//  demo org wallets. Send its address free test USDC once from
//  https://faucet.circle.com (optional: testnet ETH for EOA gas).
//
// Nothing is stored on disk — copy the output into .env.local.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const devEoaKey = generatePrivateKey();
const devEoaAddress = privateKeyToAccount(devEoaKey).address;

console.log('');
console.log('# Add to .env.local:');
console.log('');
console.log(`DEV_EOA_PRIVATE_KEY="${devEoaKey}"`);
console.log('');
console.log('# Dev EOA address — fund this once with free test USDC from https://faucet.circle.com:');
console.log(`#   ${devEoaAddress}`);
console.log('');
