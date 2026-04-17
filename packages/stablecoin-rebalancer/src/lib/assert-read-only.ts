// Stub for Clue 2 standalone compilation. Clue 1 owns the canonical version.
// At Wave 1 merge, Clue 1's version supersedes this stub.
export interface Env {
  READ_ONLY: string;
  DB: D1Database;
  CACHE: KVNamespace;
  ETH_RPC_URL: string;
  ARBITRUM_RPC_URL: string;
  BASE_RPC_URL: string;
  POLYGON_RPC_URL: string;
  TELEGRAM_CHAT_ID: string;
  GAS_ESTIMATE_USD_ETH: string;
  GAS_ESTIMATE_USD_L2: string;
  MIN_NET_EDGE_BPS: string;
  COOLDOWN_HOURS: string;
  CAPITAL_ASSUMPTION: string;
  ALCHEMY_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
}
