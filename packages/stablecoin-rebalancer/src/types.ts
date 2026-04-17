// Shared types for stablecoin-rebalancer
// Env interface lives in src/lib/assert-read-only.ts

export type Chain = 'ethereum' | 'arbitrum' | 'base' | 'polygon';
export type Protocol = 'aave-v3' | 'compound-v3' | 'yearn';
export type Asset = 'USDC' | 'USDT' | 'DAI';
