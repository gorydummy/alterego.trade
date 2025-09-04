# 06 — Stack 4: Workers

## Queues
- `q_import` — broker pagination, dedup/upsert trades, emit `import.progress`.
- `q_score` — bias scoring (heuristics + AI fallback).
- `q_sim` — what-if simulation (cache vendor OHLCV).
- `q_digest` — weekly aggregate, write S3 link, emit `digest.ready`.

## Resilience
- Backoff+Jitter on 429/5xx; bounded retries; DLQ.
- Idempotent upserts by `(userId, broker, extId)`.
- Cache OHLCV in Redis with TTL.

## Pseudocode – import job
```ts
while (hasNext) {
  const page = await broker.listTrades(cursor);
  for (const t of page) upsertTrade(t);
  appendOutbox(userId, { type: 'import.progress', payload: { fetched, stored } });
}
```
