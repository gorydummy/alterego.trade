# 07 — Stack 5: AI Coach (FastAPI)

## Endpoints
- `POST /v1/indicators` → RSI/EMA/BB/ATR
- `POST /v1/bias/score` → returns label + confidence
- `POST /v1/nlg/reflect` → short coaching text

## Contracts
- Generated **Pydantic v2** models from `contracts` JSON Schemas (codegen on build).

## Security
- HMAC headers: `X-KeyId`, `X-Timestamp`, `X-Signature` over `timestamp+body`.
- ±5m skew; body size cap; simple rate limits.

## Output
- Deterministic templates; no buy/sell directives; <= 280 chars.
