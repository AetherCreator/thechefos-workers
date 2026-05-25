export interface Env {
  AI: any;
  PERSONA: string;
  BRAIN_PATH: string;
  INTEL_LOG_URL: string;
  BRAIN_WRITE_URL: string;
  NIM_URL: string;
  NIM_MODEL: string;
  SCHEMA_VERSION: string;
  MAX_LEADS_PER_RUN: string;
  WALL_CLOCK_BUDGET_MS: string;
  PER_QUERY_SLEEP_MS: string;
  NIM_BUDGET: string;
  NIM_API_KEY: string;
  BRAIN_WRITE_SECRET: string;
  HARVEST_RUN_SECRET: string;
  BRAVE_SEARCH_API_KEY: string;
  GITHUB_TOKEN: string;
  CHANGELOG_SEEN: KVNamespace;
  // C4 additions
  MASTRO_BOT_TOKEN?: string;   // Telegram bot token for security_advisory immediate pings
  TYLER_CHAT_ID?: string;      // Telegram chat ID for Tyler direct messages
  DAILY_DIGEST_KV?: KVNamespace; // KV for daily_digest_queue (no drain in v1)
}
