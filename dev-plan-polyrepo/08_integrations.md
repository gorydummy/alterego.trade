# 08 — Integrations (Broker & Market Data)

## Coinbase (first)
- OAuth2 code flow → Core seals tokens.
- Import via Workers with paging, backoff on 429/5xx.

## Market Data
- OHLCV vendor (REST). Workers cache in Redis; normalize candles (UTC).

## Feature Flags
- `FEATURE_BINANCE`, `FEATURE_VENDOR_FALLBACK`, `HEURISTICS_ONLY`.
