# 12 — Deployment & Environments

## Option (recommended): Serverless containers + managed data
- Compute: Cloud Run (Edge/Core/Workers/AI).
- DB: Neon serverless Postgres.
- Redis: Upstash.
- Object Storage: Cloudflare R2.
- CDN/WAF: Cloudflare.

## Environments
- Dev (local), Staging (auto from main, per repo), Prod (via infra PR).

## Scale Triggers
- Reflect p95 > 3s → scale Workers/AI.
- Import backlog large → add import workers.
- Core p95/CPU high → add replica; pool conns.
- Redis evictions → increase memory/TTL.

## Secrets
- Google Secret Manager per service; no secrets in VCS.

## Backups & DR
- PG PITR, restore drill; R2 versioning; Redis ephemeral.
