import { base as viemBase, baseSepolia as viemBaseSepolia } from 'viem/chains';

// Chain configuration — the app is network-agnostic.
// Flip NEXT_PUBLIC_CHAIN=base to run the identical flows on Base mainnet
// (USDC contract, CAIP-2 id and explorer URL change; nothing else does).

export interface ChainConfig {
  name: string;
  caip2: string;
  chainId: number;
  usdcAddress: `0x${string}`;
  rpcUrl: string;
  explorerBaseUrl: string;
}

export const BASE_SEPOLIA: ChainConfig = {
  name: 'Base Sepolia',
  caip2: 'eip155:84532',
  chainId: 84532,
  // Circle's USDC on Base Sepolia
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  rpcUrl: 'https://sepolia.base.org',
  explorerBaseUrl: 'https://sepolia.basescan.org',
};

export const BASE_MAINNET: ChainConfig = {
  name: 'Base',
  caip2: 'eip155:8453',
  chainId: 8453,
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  rpcUrl: 'https://mainnet.base.org',
  explorerBaseUrl: 'https://basescan.org',
};

export function getChain(): ChainConfig {
  return process.env.NEXT_PUBLIC_CHAIN === 'base' ? BASE_MAINNET : BASE_SEPOLIA;
}

export const USDC_DECIMALS = 6;

export function usdcToWei(amountUsdc: number): bigint {
  return BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));
}

export function weiToUsdc(amountWei: bigint): number {
  return Number(amountWei) / 10 ** USDC_DECIMALS;
}

export function txUrl(txHash: string): string {
  return `${getChain().explorerBaseUrl}/tx/${txHash}`;
}

export function addressUrl(address: string): string {
  return `${getChain().explorerBaseUrl}/address/${address}`;
}

// The matching viem Chain object (for wallet/public clients).
export function viemChain() {
  return getChain().chainId === 8453 ? viemBase : viemBaseSepolia;
}
