# AI Trading Twin — Technical Solution Blueprint (v0.2)

> **Scope:** Desktop-first MVP that is *production‑ready by default* (security, privacy, observability, reliability). This version locks stack choices, tightens contracts, hardens security, and specifies idempotent jobs + rate‑limits + headers.

---

## 0) Objectives & Non‑Goals

**Objectives (MVP)**

* Connect **one** broker/exchange with **read‑only** scope.
* Import **30 days** of trades, dedupe, normalize, persist.
* Compute **bias tags** (FOMO, Panic, Discipline) via explainable heuristics.
* Generate **post‑trade reflections** and **weekly digest**; push via WS.
* Ship with **secure defaults** (CSP/HSTS, token encryption, audit trail, rate‑limits) and **SLOs**.

**Non‑Goals**

* No order placement/execution.
* No multi‑broker aggregation (beyond a second adapter behind a flag).
* No heavy backtesting; only simple counterfactuals (hold vs actual).

---

## 1) Architecture (Locked)

```
[Web / Next.js] ⇄ (HTTPS+WSS) ⇄ [BFF / Fastify]
                              ├─▶ PostgreSQL (Prisma)
                              ├─▶ Redis (BullMQ: jobs, cache)
                              ├─▶ S3/MinIO (reports/exports)
                              ├─▶ Broker Adapters (OAuth/API‑Key)
                              └─▶ Python ML Svc (FastAPI)  ⇄  Market Data (broker or vendor)
```

**Service‑to‑service auth:** BFF → ML via **mTLS** (preferred) or **HMAC signed** headers.

**Event Jobs:** `import.trades`, `score.bias`, `simulate.simple`, `digest.weekly` (idempotent, dedup keys).

---

## 2) Data Model (Prisma, with Security Notes)

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String   // scrypt/argon2id
  createdAt     DateTime @default(now())
  sessions      Session[]
  brokers       BrokerConnection[]
  trades        Trade[]
  digests       Digest[]
  rules         Rule[]
  audits        Audit[]
}

model Session {
  id         String   @id @default(cuid())
  userId     String   @index
  user       User     @relation(fields: [userId], references: [id])
  createdAt  DateTime @default(now())
  expiresAt  DateTime
  ipHash     String   // sha256(IP + secret) for analytics without storing raw IP
  uaHash     String?
}

model BrokerConnection {
  id         String   @id @default(cuid())
  userId     String   @index
  user       User     @relation(fields: [userId], references: [id])
  broker     String
  status     String   // active, paused, revoked
  accessEnc  Bytes    // AES‑GCM sealed (nonce+ct+tag)
  refreshEnc Bytes?
  scope      String
  expiresAt  DateTime?
  createdAt  DateTime @default(now())
}

model Trade {
  id        String   @id @default(cuid())
  userId    String   @index
  broker    String
  extId     String   // broker trade id
  symbol    String   @index
  side      String   // BUY/SELL
  qty       Decimal
  price     Decimal
  fee       Decimal?
  ts        DateTime @index
  UNIQUE_trade_user_extid  @@unique([userId, broker, extId])
}

model BiasTag {
  id          String   @id @default(cuid())
  tradeId     String   @index
  label       String   // FOMO|PANIC|DISCIPLINE|...
  confidence  Float
  features    Json
  createdAt   DateTime @default(now())
}

model Digest {
  id          String   @id @default(cuid())
  userId      String   @index
  periodStart DateTime
  periodEnd   DateTime
  payload     Json
  deliveredAt DateTime?
}

model Rule {
  id        String   @id @default(cuid())
  userId    String   @index
  kind      String   // e.g., avoidSpikeOverPct
  params    Json
  active    Boolean  @default(true)
}

model Audit {
  id        String   @id @default(cuid())
  userId    String   @index
  action    String   // login, broker_linked, import_start, import_done, etc.
  meta      Json
  createdAt DateTime @default(now())
}
```

**Security notes:**

* Token material stored **encrypted** (`accessEnc`, `refreshEnc`) using AES‑256‑GCM with a per‑record random nonce + key from KMS/age/libsodium. No plaintext tokens in DB or logs.
* IP/UA hashed for privacy; raw IP never stored.

---

## 3) API Surface (BFF, REST + WSS)

All endpoints require **session cookie** (HttpOnly/Secure/SameSite=Lax) + **CSRF** for mutating requests (double‑submit cookie). Strict **rate limits** (per IP+user) and **idempotency keys** for POSTs.

### REST

```
POST /api/auth/signup            (email, password)
POST /api/auth/login             (email, password)
POST /api/auth/logout
GET  /api/auth/me

POST /api/brokers/:broker/connect/start      // redirects to OAuth; returns state
GET  /api/brokers/:broker/connect/callback   // handles exchange, stores tokens
POST /api/brokers/:broker/pause              // pause imports

POST /api/trades/import        // body: { since?: ISO }  -> 202 Accepted (job id)
GET  /api/trades               // query: since, until, cursor, limit
GET  /api/trades/:id/bias

POST /api/simulations/simple   // { tradeId?: string, symbol?: string, horizonDays: number }
GET  /api/digests/weekly/latest
GET  /api/rules                 // list rules
POST /api/rules/upsert          // idempotent by rule.kind
```

### WebSocket

```
GET /ws/coach
Auth: cookie session; server validates & upgrades.
Events (server→client):
  coach.reflect, import.progress, digest.ready
Events (client→server):
  chat.ask_reflection, chat.feedback (thumbs up/down), note.add
```

### Rate Limits (defaults)

* `auth/*`: 10 req/min/IP, burst 20.
* `trades/import`: 3/min/user, dedupe by payload hash.
* `simulations/simple`: 10/min/user.
* WS connections: 1 per tab, 5 concurrent per user.

### Common Headers

* `Content-Security-Policy`: `default-src 'self'; script-src 'self'; connect-src 'self' https://api.openai.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` *(adjust vendor domains as needed)*
* `Strict-Transport-Security`: `max-age=31536000; includeSubDomains; preload`
* `Referrer-Policy`: `strict-origin-when-cross-origin`
* `Permissions-Policy`: disable sensors/camera/mic/geolocation
* `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP frame‑ancestors)

---

## 4) Validation (Zod DTOs, shared package)

```ts
export const TradeDto = z.object({
  id: z.string(), userId: z.string(), broker: z.string(), symbol: z.string(),
  side: z.enum(['BUY','SELL']), qty: z.number().positive(), price: z.number().positive(),
  fee: z.number().nonnegative().optional(), ts: z.string().datetime(), extId: z.string()
});

export const ImportRequest = z.object({ since: z.string().datetime().optional() });
export const BiasTagDto = z.object({
  tradeId: z.string(), label: z.enum(['FOMO','PANIC','DISCIPLINE']),
  confidence: z.number().min(0).max(1), features: z.record(z.any())
});

export const SimulationRequest = z.object({
  tradeId: z.string().optional(), symbol: z.string().optional(), horizonDays: z.number().min(1).max(30)
}).refine(x => !!(x.tradeId || x.symbol), { message: 'tradeId or symbol required' });

export const CoachEvent = z.object({
  type: z.enum(['coach.reflect','import.progress','digest.ready']),
  tradeId: z.string().optional(), labels: z.array(z.object({ name: z.string(), confidence: z.number() })).optional(),
  insight: z.string().optional(), sparklines: z.any().optional()
});
```

---

## 5) Broker Adapter (Interface & Hardening)

```ts
export interface BrokerAdapter {
  id: 'coinbase' | 'binance' | string;
  auth: 'oauth2' | 'apiKey';
  startAuth?(ctx): Promise<{ url: string; state: string }>; // OAuth only
  completeAuth?(ctx): Promise<{ accessTokenEnc: Buffer; refreshTokenEnc?: Buffer; expiresAt?: Date; scope: string }>; 
  fetchTrades(input: { userId: string; since?: Date; until?: Date; cursor?: string }): Promise<{ trades: RawTrade[]; cursor?: string }>;
  fetchOHLCV?(symbol: string, granularity: string, since: Date, until: Date): Promise<Candle[]>;
}
```

**Security:**

* `state` + PKCE for OAuth; verify nonce/state; store short‑lived auth intents in Redis.
* IP‑allowlist outbound to broker APIs where possible. Exponential backoff + jitter.
* **Dedupe** by `(userId, broker, extId)`; **idempotent** import jobs using a deterministic `jobId = sha256(userId+since+until+broker)`.

---

## 6) Bias Tagging (Heuristics v1, Personalization v1.1)

**Features:** `pct_change_1h/24h_before`, `RSI_14`, `ATR_rel`, `BB_pos`, `gap_from_MA`, `held_hours`, `pnl_exit`, `drawdown_recent`.

**Heuristics:**

* **FOMO Buy**: `BUY` & `pct_change_24h_before >= 8%` & `RSI_14 >= 70` & `BB_pos >= 0.8`.
* **Panic Sell**: `SELL` & `pnl_exit < 0` & `drawdown_recent >= 6%` & `RSI_14 <= 35`.
* **Discipline**: Entry within `x%` of prior support | rule matched (`minHoldHours`, stop respected).

**Personalization (v1.1):**

* Calibrate thresholds per user with Bayesian update after 30+ trades; store in `Rule.params`.

**Explainability:** persist `features` in `BiasTag.features` for auditability and LLM prompting.

---

## 7) Simulation (Simple Counterfactuals)

* **Hold vs Actual**: reprice entry at `ts` to `ts + horizonDays` using OHLCV; compute P/L vs actual outcome.
* **Wait‑then‑enter**: delay entry until a pullback (e.g., −2% from spike) then hold to horizon.
* Cache results per `(userId, tradeId, horizonDays)` in Redis with TTL.

---

## 8) Python ML Service (FastAPI)

**Endpoints**

```
POST /v1/indicators: { ohlcv[], entryTs } -> { RSI_14, ATR_rel, BB_pos, ... }
POST /v1/bias/score: { features } -> { label, confidence }
POST /v1/nlg/reflect: { features, label, tone } -> { text }
```

**Security**: mTLS (preferred) or `X-Signature: HMAC(sha256, body)` + `X-Timestamp` (±5m). Reject if clock‑skew or replay. Enforce payload size limits.

**Performance**: vectorize with numpy/pandas; precompute rolling indicators; UJSON for (de)serialization.

---

## 9) LLM Orchestration (Guardrails)

* **System prompt**: “You are a *trading psychology coach*. Do **not** give financial advice. Focus on behavior. Keep outputs 2 sentences, 1 concrete habit.”
* **JSON mode**: `{ "text": string, "tone": "supportive|strict", "bias": "FOMO|PANIC|DISCIPLINE" }`
* **PII minimization**: send only feature summaries, never raw tokens or broker IDs.
* **Safety**: profanity filter off by default but respect user tone; never promise profits.
* **Caching**: Redis keyed by hash(features + label + tone).

---

## 10) Realtime (WSS) — Auth & Delivery Guarantees

* **Auth**: On upgrade, validate session cookie; bind `userId` to WS context; rotate WS token every 24h.
* **Backpressure**: bounded queue per socket (e.g., 100 msgs) → drop oldest with a `synced=false` marker.
* **At‑least‑once** delivery: also persist events needed for UI in DB or cache so client can fetch missed on reconnect.
* **Reconnect**: jittered exponential backoff; resume by `lastEventId`.

---

## 11) Job/Queue Semantics (BullMQ)

* Separate queues: `q_import`, `q_score`, `q_sim`, `q_digest`.
* **Idempotency**: `jobId` = hash of semantics (e.g., import window, tradeId+horizon); `removeOnComplete` + DLQ.
* **Retries**: 5 tries, exp backoff (2^n \* 500ms), circuit‑break on broker 429/5xx.
* **Concurrency**: import=2, score=8, sim=4, digest=2 (tune later).
* **Metrics**: queue depth, processing latency, failure rate.

---

## 12) Security Posture (Production by Default)

* **Sessions**: HttpOnly, Secure, SameSite=Lax, rotation on login; session fixation prevention.
* **Passwords**: Argon2id (tuned), password policy + breach check (k‑Anon HIBP optional).
* **CSRF**: double‑submit cookie for POST/PUT/DELETE; verify origin on sensitive routes.
* **CSP/HSTS**: strict by default (see headers above). No inline scripts except hashed if needed.
* **Secrets**: env via platform secrets; encrypt at rest; short‑lived OAuth tokens; rotate refresh tokens.
* **KMS**: managed KMS or libsodium with envelope keys; per‑record nonces.
* **PII minimization**: avoid storing raw IP/UA; allow **data export & deletion** (GDPR‑style flows).
* **Audit log**: key actions with `userId`, coarse metadata; redaction of sensitive values.
* **WAF/CDN**: optional Cloudflare in front for DDoS, bot, geo rules.
* **Dependency hygiene**: lockfiles, Renovate, `npm audit`, Snyk/Trivy scans, SBOM in CI.
* **Container hardening**: non‑root user, read‑only fs where possible, seccomp profile.
* **Backups**: PostgreSQL PITR, daily snapshots; Redis RDB/AOF as needed; restore drills.

---

## 13) Observability & SLOs

* **Logs**: pino (redact tokens), correlation IDs; Python logs structured.
* **Metrics**: Prometheus + Grafana dashboards (imports/min, bias/share, WS p50/p95 latency, job failures).
* **Tracing**: OpenTelemetry spans BFF↔ML; export to OTEL collector.
* **SLOs**:

  * Import 30d ≤ **60s** (p95) for ≤1k trades.
  * Bias scoring ≤ **200ms**/trade (p95, batched).
  * WS reflect push ≤ **500ms** (p50) from import.
* **Alerts**: queue failure rate >2%, WS error rate >1%/min, API p95 > 800ms.

---

## 14) Deployment & Infra

* **Monorepo** (`pnpm`, Turborepo):

```
/apps
  /web (Next.js)
  /bff (Fastify, BullMQ, Prisma)
/services
  /ml (FastAPI)
/packages
  /shared (zod DTOs, types)
  /adapters (broker integrations)
/infra
  docker-compose.yml (dev), k8s/ (prod manifests), prisma/
```

* **Dev**: Docker Compose for Postgres/Redis/MinIO; local apps.
* **Prod**: Docker on VM or K8s; reverse proxy (Caddy/NGINX) with auto TLS; HSTS preload.
* **CI/CD**: GitHub Actions — build/test → Docker → GHCR → deploy script; add SAST (CodeQL), Trivy image scan, SBOM (Syft), license checks.

---

## 15) Market Data Strategy (MVP)

* Prefer broker OHLCV if quotas allow; otherwise add vendor module (e.g., 12data/Alpha Vantage/ CoinAPI) behind feature flag.
* Cache OHLCV (symbol, granularity, window) in Redis with TTL; rate‑limit vendor calls.

---

## 16) Acceptance Criteria (Demo‑Ready)

* User signs up → logs in (secure cookies, headers present).
* Connects broker (OAuth/API‑Key); **Audit** entry created; tokens **encrypted** at rest.
* Imports 30d trades in ≤60s; duplicates suppressed; trades visible in UI.
* Each trade has ≥1 **BiasTag** with explainable `features`.
* “Open Simulation” yields a chart diff and JSON payload.
* WS pushes **coach.reflect** message upon scoring; client can recover missed events via `lastEventId`.
* Weekly digest endpoint returns JSON; stored in DB; can render in UI.

---

## 17) Scaffold Checklist (Day‑1 Dev)

* Monorepo init with pnpm + Turborepo; shared `@app/shared` package with Zod DTOs.
* Fastify BFF boot with security headers, rate‑limits, CSRF, session cookies.
* Prisma schema migrated; seed script creates demo user & trades.
* BullMQ queues + workers wired with metrics.
* FastAPI service with `/v1/indicators` + `/v1/nlg/reflect` echos.
* Next.js web wired to BFF; WSS client that shows fake `coach.reflect`.

---

## 18) Open Questions (short list)

* First adapter: **Coinbase Advanced Trade (OAuth)** vs **Binance (API‑Key)**? (OAuth preferred for revocation UX.)
* Vendor data: lock one (cost vs quota) for stability before beta.
* mTLS feasibility in your infra now? If not, ship HMAC first, mTLS in 0.2.1.

---

**v0.2 locked.** Next step: generate **repo scaffolding** (folders, starter files, security headers, middlewares, queues) and stub endpoints consistent with this spec.
