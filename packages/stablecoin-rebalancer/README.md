# stablecoin-rebalancer

Read-only monitoring Worker for stablecoin yield opportunities across Aave v3, Compound v3, and Yearn on Ethereum, Arbitrum, Base, and Polygon.

**v1 is monitoring-only. NO private keys, NO wallet code, NO on-chain transactions.**

## Resources
- D1 database: `stablecoin-rebalancer`
- KV namespace: `stablecoin_cache`

## Endpoints
- `GET /api/health` — health check

## Cron
Runs hourly to snapshot rates.
