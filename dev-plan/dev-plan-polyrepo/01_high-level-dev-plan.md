# 01 — High-Level Development Plan (Polyrepo)

## Goals
- Ship a production-ready MVP focused on trading psychology (bias tagging, reflections, simple simulations, weekly digest).
- Keep costs low, security strong, and scale via horizontal elasticity.
- Support **web now**, **mobile later** with the same backend contracts.

## Repos (polyrepo)
- `web-ui` — S1 Next.js app (SSR + SPA).
- `edge-bff` — S2 Edge/Backend-for-Frontend (Express/Fastify): auth, CSRF, WebSockets, idempotency, fanout.
- `core-api` — S3 domain services + Postgres/Redis, event outbox, JWKS.
- `workers` — S4 BullMQ workers (import, score, simulate, digest).
- `ai-coach` — S5 FastAPI service (indicators, bias scoring, NLG reflection).
- `contracts` — Shared Zod DTOs (+ JSON Schemas for Python).
- `infra` — Terraform for Cloud Run + Neon Postgres + Upstash Redis + Cloudflare R2 + Cloudflare DNS/CDN.

## User-Facing Scope (MVP)
- Connect broker (Coinbase first) → import last 30d trades.
- Tag trades with behavioral biases (FOMO, PANIC, DISCIPLINE, NEUTRAL).
- Real‑time “coach reflect” bubbles in chat UI.
- Lightweight “what‑if” simulation (hold/sell compare).
- Weekly digest (bias counts, P&L deltas, streaks).

## System Overview (S1–S5)
- S1 calls S2 for REST and WS under one origin.
- S2 validates JWT/CSRF, fans out events, and proxies to S3.
- S3 exposes internal APIs, persists data, appends `EventOutbox`.
- S4 consumes jobs, calls AI, writes events.
- S5 provides indicators, bias scoring, and templated reflections.

## Non-Goals (MVP)
- No auto-trading/execution; purely coaching + analytics.
- No multi-region WS fanout (single region to start).

## Release Model
- **Staging:** auto-deploy service on merge to `main` in that repo.
- **Prod:** promote by service tag (e.g., `edge-v1.5.0`) via a PR to `infra` that pins the image digest.
