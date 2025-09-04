# 09 — Observability & Ops

## SLO Targets
- Login availability ≥ 99.9%, p95 ≤ 250ms.
- Reflect delivery median ≤ 1.5s, p95 ≤ 3s.
- Import 30d/500 trades p95 ≤ 60s.
- Simulation p95 ≤ 3s (cold), ≤ 1s (warm).
- Weekly digest by Mon 09:00 UTC for 99%.

## Metrics (examples)
- `http_requests_total`, `http_request_duration_seconds_bucket`
- `event_delivery_lag_ms_bucket`
- `job_duration_ms_bucket`, `queue_depth`
- `ai_request_total`, `ai_request_errors_total`

## Alerts
- Edge availability burn < 99.9% (10m).
- Reflect p95 > 3s (10m).
- Import backlog > 200 (15m).
- AI error rate > 5% (10m).
- Postgres locks/bloat.

## Runbooks
- Edge availability, Reflect latency, Import backlog, AI error rate, PG locks, Redis evictions, WS fanout, JWT rotation.

## Tracing
- OpenTelemetry across S2→S3→S4→S5; Tempo/Jaeger.

## Logging
- JSON; redact secrets; no emails/PII; use `userId` only.
