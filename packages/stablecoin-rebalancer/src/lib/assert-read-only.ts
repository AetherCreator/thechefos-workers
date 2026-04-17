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

export function assertReadOnly(env: Env): void {
  if (env.READ_ONLY !== "true") {
    throw new Error(
      "READ_ONLY not enabled — refusing to execute. " +
      "v1 is monitoring-only. There is NO code path in this Worker that can spend capital. " +
      "Any attempt to send a transaction requires a separate Phase-2 hunt with explicit capital decision."
    );
  }
}
