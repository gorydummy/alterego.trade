# AI Trading Twin — Technical Solution Blueprint (v0.1)

> High‑level architecture, building blocks, data contracts, and delivery plan for the desktop‑first MVP. Optimized for a TypeScript + Python polyglot stack, DDD, and your existing infra preferences (PostgreSQL, Prisma, Redis, S3/MinIO, queues, CI/CD).

---

## 0) Goals & Non‑Goals (MVP)

**Goals**

* Ingest 30d of trade history from one exchange/broker.
* Tag each trade with a behavioral label (FOMO/Panic/Discipline/etc.).
* Provide post‑trade reflection in chat + simple simulations (hold vs. actual).
* Weekly digest summarizing bias impact and suggested micro‑challenges.

**Non‑Goals**

* Automated execution or order placement.
* Multi‑broker portfolio aggregation beyond the first 1–2 connectors.
* Quant strategy backtesting; we keep simulations simple and local to the user’s trades.

---

## 1) System Architecture (MVP)

```
[Web App (Next.js)] ──WS/HTTP──▶ [BFF/API (Fastify)] ──RPC/Queue──▶ [Python ML Svc]
       │                               │                         │
       │                               ├──▶ [Broker Adapters]    │
       │                               │        (REST/OAuth)     │
       │                               ├──▶ [Redis/BullMQ] ◀─────┘
       │                               ├──▶ [PostgreSQL (Prisma)]
       │                               └──▶ [S3/MinIO]
```

* **Web App**: Next.js (app router), Tailwind, Zustand; chat‑first UI + dashboard + digest.
* **BFF/API**: Fastify (Node/TS) with DDD modules: `auth`, `trades`, `insights`, `coach`, `brokers`.
* **Python ML Service**: gRPC/HTTP microservice for bias scoring & NLG prompt helpers.
* **Data**: PostgreSQL via Prisma; Redis for queues + cache; S3/MinIO for exports/snapshots.
* **Events**: BullMQ jobs: `import.trades`, `score.bias`, `simulate.simple`, `digest.weekly`.

---

## 2) Domain Model (ERD Outline)

```
User(id, email, auth_provider, created_at)
BrokerConnection(id, user_id, broker, status, access_token_hash, refresh_token_hash, scope, expires_at)
Trade(id, user_id, broker, symbol, side, qty, price, fee, ts)
BiasTag(id, trade_id, label, confidence, features_json, created_at)
Session(id, user_id, started_at, ended_at)  // chat/analysis session
Insight(id, user_id, kind, payload_json, created_at)
Rule(id, user_id, kind, params_json, active)  // e.g., “avoid spike entries >10%”
Challenge(id, user_id, name, status, streak_count, started_at)
Digest(id, user_id, period_start, period_end, payload_json, delivered_at)
```

**Indexes**: `Trade(user_id, ts)`, `BiasTag(trade_id)`, `Digest(user_id, period_end)`.

---

## 3) Broker Integration Layer

**Adapter Interface**

```ts
interface BrokerAdapter {
  exchange: 'binance' | 'coinbase' | 'robinhood' | string;
  auth: {
    kind: 'oauth2' | 'apiKey';
    authorizeUrl?: string; // if oauth
  };
  fetchTrades(params: { userId: string; since?: Date; until?: Date; pageToken?: string }): Promise<{
    trades: RawTrade[];
    nextPageToken?: string;
  }>;
}
```

**MVP target**: 1 crypto exchange (Binance or Coinbase Advanced Trade). OAuth/API‑key credentials stored encrypted at rest; refresh via server only (never in browser).

**Normalization**: Convert `RawTrade` → `Trade` with consistent fields/timezones; drop unsupported types initially (e.g., options) to keep scope tight.

---

## 4) Bias Tagging Pipeline (Hybrid Heuristics + ML)

**Feature extraction** (per trade):

* `pct_change_1h_before`, `pct_change_24h_before`, `candle_shape_at_entry`, `RSI_at_entry`, `distance_from_BB`, `ATR_relative`.
* `entry_after_spike` (boolean, e.g., >8–10% move in last 24h/4h).
* `sold_after_drawdown` (boolean, exit after X% DD without bounce attempts).
* `held_duration_hours`, `profit_at_exit`.

**Heuristic labels (MVP)**

* **FOMO Buy**: `side=BUY` AND `entry_after_spike=true` AND `RSI>70`.
* **Panic Sell**: `side=SELL` AND `exit at loss` AND `recent_dd > threshold` AND `RSI<35`.
* **Discipline**: trade meets pre‑defined rules (e.g., entered near prior support, risk\:reward ≥ 1:1, stop respected).

**ML refinement (vNext)**

* Train a lightweight classifier on user’s trades to personalize thresholds (calibrated over time; start global, personalize w/ Bayes update).

**LLM reflection**

* Prompt template summarizes features + outcome; returns a natural‑language explanation and advice in user‑selected tone.

---

## 5) Coaching Loop (Realtime & Batch)

**Realtime**

1. Trade imported (near‑real‑time if broker supports `userDataStream`/webhook).
2. Job: `score.bias` computes labels + emits `coach.reflect` event.
3. WebSocket push → chat inserts clone message with inline mini‑chart.

**Batch**

* Nightly/weekly `digest.weekly` aggregates: counts by label, P/L attribution, streaks; generates advice + micro‑challenge suggestions.

**Rules Engine (user‑tunable)**

* JSON rule schema, e.g.: `{ "avoidSpikeOverPct": 10, "minHoldHours": 24 }`.
* Violations create insights + notifications; toggled via UI.

---

## 6) APIs (BFF) — Contracts (MVP)

```http
POST /api/auth/start-oauth/:broker
GET  /api/auth/callback/:broker   // server handles token exchange
POST /api/trades/import           // { since?: ISO } → 202 Accepted
GET  /api/trades?since&until&limit&cursor
GET  /api/trades/:id/bias         // returns BiasTag(s)
POST /api/simulate/simple         // { tradeId | symbol, horizonDays } → pnl curve
GET  /api/digest/weekly/latest
WS   /ws/coach                    // server → client events: reflect, digest_ready
```

**Event payloads (WS)**

```json
{
  "type": "coach.reflect",
  "tradeId": "t_123",
  "labels": [{"name": "FOMO", "confidence": 0.82}],
  "insight": "You bought after a +12% pump...",
  "sparklines": {"actual": [...], "hold": [...]}
}
```

---

## 7) Service Boundaries (DDD Modules)

* **auth**: sessions, broker OAuth/key mgmt, token rotation.
* **brokers**: adapters, normalization, rate‑limit/backoff.
* **trades**: storage, queries, import jobs, dedupe.
* **analytics**: feature engineering, bias scoring, simulations.
* **coach**: LLM prompts, rule evaluation, messaging.
* **digest**: weekly aggregation + delivery.

Each module exposes application services; repositories via Prisma; messages via BullMQ.

---

## 8) LLM Orchestration

* Provider‑agnostic client with retry/backoff + deterministic prompts.
* **Prompt inputs**: compact feature summary, 2–3 key stats, 1–2 charts (as textual sparkline arrays for now).
* **Guardrails**: prepend compliance disclaimer; avoid prescriptive financial advice → frame as behavioral coaching (“consider”, “notice that”).

**Prompt Sketch**

```
System: You are a trading psychology coach. Never give financial advice; focus on behavior.
User context: {features_json}
Task: Explain likely bias and suggest 1 actionable habit in 2 sentences, tone={supportive|strict}.
```

---

## 9) Privacy, Security, Compliance

* **Storage**: encrypt tokens at rest (AES‑256‑GCM via KMS or libsodium). Hash refresh tokens.
* **Scopes**: read‑only access only. No trading permissions in MVP.
* **PII**: minimize; separate PII table from trade data; row‑level access by `user_id`.
* **Transport**: TLS everywhere. WS over WSS only.
* **Secrets**: 12‑factor; per‑env secrets via Vault/Cloud KMS/DO Secrets.
* **Compliance posture**: not an investment advisor; behavioral coaching tool. Prominent disclaimers in UI + ToS.

---

## 10) Observability & Quality

* **Logging**: pino (JSON), request IDs, redaction of tokens.
* **Metrics**: Prometheus counters (imports, labels per bias, WS pushes), timers (latency).
* **Tracing**: OpenTelemetry traces across BFF ↔ Python ML.
* **Testing**: unit (vitest/jest + pytest), contract tests (pact), e2e (Playwright), seed datasets for replayable trade scenarios.

---

## 11) Performance Targets (MVP)

* Import 30d of trades ≤ 60s for 1k events.
* Bias scoring ≤ 150ms per trade (batched).
* WS delivery ≤ 500ms p50 from import to chat reflection.

---

## 12) Deployment & Infra

* **Monorepo** (pnpm): `apps/web`, `apps/bff`, `services/ml`, `packages/shared` (types, DTOs, zod schemas).
* **CI/CD**: GitHub Actions → build, lint, tests, dockerize, push GHCR, deploy to DO/AWS.
* **Runtime**: Docker Compose for dev; k8s or Docker Swarm for prod; Redis + Postgres managed if available.
* **Zero‑downtime**: rolling deploy; DB migrations via Prisma Migrate.

---

## 13) Roadmap to v0.2

* Add second broker adapter; webhook ingestion if supported.
* Personalization of thresholds via online learning.
* Rule editor in UI; export PDF/CSV.
* Persona marketplace (limited access behind feature flag).

---

## 14) Open Questions (To Validate Quickly)

* First broker: Binance (API‑key) vs. Coinbase Advanced Trade (OAuth)?
* Price/indicator source: broker historical vs. 3rd‑party OHLCV (to avoid broker limits)?
* Local‑first mode requirement (privacy) vs cloud‑only for MVP?

---

## 15) Example Folder Structure (Monorepo)

```
/ (repo)
  /apps
    /web (Next.js)
    /bff (Fastify, BullMQ, Prisma)
  /services
    /ml (Python, FastAPI or gRPC, scikit/numba)
  /packages
    /shared (zod types, DTOs, utils)
    /adapters (broker SDKs, normalized)
  /infra
    docker-compose.yml
    k8s/ (manifests)
    prisma/
```

---

## 16) Acceptance Criteria (MVP Demo)

* User connects broker; 30d trades appear within 1 minute.
* Each trade shows a bias label with confidence and a 1‑line explanation.
* Chat shows at least one realtime reflection for a new trade import.
* Weekly digest endpoint returns a populated summary payload.

---

**End of v0.1 Blueprint** — ready to refine into a product spec (user stories, flows, API DTOs) and start scaffolding the repo.
