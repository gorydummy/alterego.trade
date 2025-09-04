# AI Trading Twin — Development Plan per Stack (v0.2)

> Copy‑ready plan. Part A = high‑level per‑stack roadmap. Part B = **Stack 0: Data & ERD Foundation** with project structure + file‑by‑file pseudocode so we can implement and test granularly. Subsequent stacks will follow the same pattern.

---

## Part A — High‑Level Plan by Stack

### 1) Web App (Next.js, Tailwind, Zustand)

**Goal:** Desktop UI for chat (coach reflections), dashboard, digest, rules; secure session; WSS client + resume.

* **Milestones:**

  * M1 Shell: layout, routing, auth guard, secure cookie checks.
  * M2 Chat MVP: render `coach.reflect`, CTA → simulation modal, `lastEventId` resume.
  * M3 Dashboard: bias timeline, tagged trades grid.
  * M4 Digest: weekly card + detail view.
  * M5 Settings: rules create/toggle; export/delete flows.
* **Testing:** Vitest components; Playwright E2E; DTO contract checks.

### 2) BFF/API (Fastify, Prisma, BullMQ, WebSocket)

**Goal:** Auth, broker connect, import pipeline, bias scoring orchestration, simulations, WS fan‑out.

* **Milestones:**

  * M1 Security base: sessions (HttpOnly), CSRF, headers, rate‑limit, audits.
  * M2 Broker connect (Coinbase OAuth): state/PKCE, encrypted tokens.
  * M3 Import endpoint + job enqueue + progress events.
  * M4 Bias scoring orchestrator → `BiasTag` + outbox event.
  * M5 Simulations endpoint + caching.
  * M6 Weekly digest cron + event.
* **Testing:** Unit (services/repos), integration (Testcontainers PG/Redis), Pact/DTO schema tests.

### 3) Workers / Queue Layer (BullMQ)

**Goal:** Reliable background processing with idempotency, retries, metrics.

* **Queues:** `q_import`, `q_score`, `q_sim`, `q_digest`.
* **Milestones:**

  * M1 Queue boot + shared job base (logging, retry, metrics).
  * M2 Import worker: page fetch, normalize, dedupe, progress.
  * M3 Score worker: features → heuristics → tags + outbox.
  * M4 Sim worker: hold vs actual; cache; vendor 429 backoff.
  * M5 Digest worker: aggregate, store, event.
* **Testing:** Unit for handlers (fixtures), integration with Redis; failure/retry cases.

### 4) Python ML Service (FastAPI)

**Goal:** Deterministic indicators, heuristic bias helper, concise NLG reflection helper.

* **Endpoints:** `/v1/indicators`, `/v1/bias/score`, `/v1/nlg/reflect`.
* **Milestones:**

  * M1 Indicators: RSI/ATR/BB/MA (vectorized) + tests.
  * M2 Heuristic scorer parity with BFF thresholds.
  * M3 NLG helper (short coach text, JSON mode).
* **Testing:** Pytest numerics; schema tests; HMAC verification; perf checks.

### 5) Broker Adapters (Coinbase primary; Binance behind flag)

**Goal:** Read‑only trade import; OAuth/API‑key flows; normalization.

* **Milestones:**

  * M1 Adapter interface + shape tests; OAuth intent cache.
  * M2 Coinbase: OAuth, pagination, extId dedupe.
  * M3 Binance (flag): API‑key mapping parity.
* **Testing:** Stub servers + fixtures; contract tests; backoff behavior.

### 6) Market Data Adapter

**Goal:** OHLCV source selection (broker first, vendor fallback), caching, S3 snapshots.

* **Milestones:**

  * M1 Adapter interface; Redis cache (symbol/granularity/window).
  * M2 Broker OHLCV; graceful gaps.
  * M3 Vendor fallback (flag) + weekly S3 snapshots for reproducibility.
* **Testing:** Deterministic fixtures; cache hit/miss; throttle simulation.

### 7) Data Layer & Migrations (Prisma, Postgres)

**Goal:** Schemas, migrations, indexes, seed scripts, event outbox partitions.

* **Milestones:**

  * M1 Core models: `User`, `Session`, `BrokerConnection`, `Trade`.
  * M2 `BiasTag`, `Rule`, `Digest`, `Audit`, `event_outbox` (partitioned).
  * M3 Seeds: demo user, trade fixtures, OHLCV seeds.
* **Testing:** Migration tests; query perf on 1k–10k trades; retention tests.

### 8) Security & Compliance

**Goal:** Production‑ready by default.

* **Milestones:**

  * M1 Headers (CSP/HSTS/etc), CSRF, session fixation prevention, Argon2id.
  * M2 Token sealing (AES‑GCM; DEK via KMS), breach checks.
  * M3 Export/delete; audit trails; privacy copy.
* **Testing:** Header checks; cookie flags; encryption round‑trip; delete/export E2E.

### 9) Observability & Ops

**Goal:** Visibility + SLO proof.

* **Milestones:**

  * M1 Pino JSON + request IDs; structured Python logs.
  * M2 Prometheus exporters; Grafana queues/WS/import dashboards.
  * M3 OpenTelemetry traces; alert rules.
* **Testing:** Synthetic probes; chaos tests (kill ML → retries/alerts).

### 10) Testing & QA

**Goal:** Confidence with speed.

* **Milestones:**

  * M1 Unit scaffold; DTO/contract tests; broker stub service.
  * M2 Integration (Testcontainers) for import→score path.
  * M3 Playwright E2E: Must scenarios; 429 UX; WS reconnect/replay.
* **Done:** CI gates enforce PR (unit+contracts) and main (full suite); SAST/Trivy/CodeQL clean.

---

## Part B — Stack 0: Data & ERD Foundation (Project Structure + Pseudocode)

### B.1 Canonical Entities & Fields (consistent across all stacks)

```
User(id, email, passwordHash, createdAt)
Session(id, userId, createdAt, expiresAt, ipHash, uaHash?)
BrokerConnection(id, userId, broker, status, accessEnc, refreshEnc?, scope, expiresAt?, createdAt)
Trade(id, userId, broker, extId, symbol, side, qty, price, fee?, ts)
BiasTag(id, tradeId, label, confidence, features(json), createdAt)
Rule(id, userId, kind, params(json), active)
Digest(id, userId, periodStart, periodEnd, payload(json), deliveredAt?)
Audit(id, userId, action, meta(json), createdAt)
EventOutbox(id, userId, type, v, ts, payload(json), deliveredAt?)
```

**Indexes & constraints**

* `Trade UNIQUE(userId, broker, extId)`; `Trade(userId, ts)`; `BiasTag(tradeId)`; `Digest(userId, periodEnd)`.
* Partition `EventOutbox` by month on `ts`.

### B.2 ASCII ERD

```
User 1───* Session
  │
  ├───* BrokerConnection
  │
  ├───* Trade 1───* BiasTag
  │
  ├───* Rule
  │
  ├───* Digest
  │
  └───* Audit

EventOutbox (*userId) ──(events for UI replay; not a UI entity)
```

### B.3 Repo Structure (data‑centric parts)

```
repo/
  apps/
    bff/
      src/
        modules/
          trades/
            TradeRepo.ts
            TradeService.ts
          biases/
            BiasRepo.ts
          rules/
            RuleRepo.ts
          digest/
            DigestRepo.ts
          events/
            OutboxRepo.ts
        lib/
          db.ts (Prisma client)
          crypto/
            keyring.ts (KMS/DEK unwrap)
            tokenSeal.ts (AES‑GCM, encode/decode)
  packages/
    shared/
      src/dto/
        trade.ts, bias.ts, simulation.ts, event.ts (Zod)
  prisma/
    schema.prisma
    migrations/
    seeds/
      seedTrades.ts
      seedOHLCV.json
```

### B.4 Key Files — Pseudocode

#### prisma/schema.prisma (excerpt)

```prisma
model Trade {
  id       String   @id @default(cuid())
  userId   String   @index
  broker   String
  extId    String
  symbol   String   @index
  side     String
  qty      Decimal
  price    Decimal
  fee      Decimal?
  ts       DateTime @index
  @@unique([userId, broker, extId])
}

model BiasTag {
  id         String   @id @default(cuid())
  tradeId    String   @index
  label      String
  confidence Float
  features   Json
  createdAt  DateTime @default(now())
}

model EventOutbox {
  id          String   @id // ULID
  userId      String   @index
  type        String
  v           Int      @default(1)
  ts          DateTime @default(now()) @index
  payload     Json
  deliveredAt DateTime?
  @@index([userId, ts])
}
```

#### apps/bff/src/modules/trades/TradeRepo.ts

```ts
export class TradeRepo {
  constructor(private prisma: PrismaClient) {}

  async upsertMany(userId: string, items: TradeDto[]): Promise<number> {
    // idempotent by (userId, broker, extId)
    // use prisma.$transaction with upsert or onConflict DO NOTHING via raw query for speed
  }

  async list(userId: string, since?: Date, until?: Date, cursor?: string, limit = 100) {
    // cursor pagination by ts,id
  }
}
```

#### apps/bff/src/modules/biases/BiasRepo.ts

```ts
export class BiasRepo {
  constructor(private prisma: PrismaClient) {}
  async create(tag: BiasTagDto) { /* insert */ }
  async listByTrade(tradeId: string) { /* query */ }
}
```

#### apps/bff/src/modules/events/OutboxRepo.ts

```ts
export class OutboxRepo {
  constructor(private prisma: PrismaClient) {}
  async append(userId: string, type: string, payload: unknown, v = 1) {
    // insert ULID id, now(), payload JSON
  }
  async listSince(userId: string, eventId: string) { /* ordered by ts asc */ }
  async markDelivered(ids: string[]) { /* set deliveredAt */ }
}
```

#### apps/bff/src/lib/crypto/keyring.ts

```ts
// unwrap per-tenant DEK via KMS; cache in memory with rotation TTL
export async function getDEK(): Promise<CryptoKey> { /* KMS call / cache */ }
```

#### apps/bff/src/lib/crypto/tokenSeal.ts

```ts
export async function sealToken(plaintext: string): Promise<Buffer> { /* AES-GCM( DEK, nonce, aad ) */ }
export async function openToken(cipher: Buffer): Promise<string> { /* verify tag; throw on fail */ }
```

#### apps/bff/src/modules/digest/DigestRepo.ts

```ts
export class DigestRepo {
  async upsertLatest(userId: string, period: {start: Date, end: Date}, payload: any) { /*...*/ }
  async latest(userId: string) { /*...*/ }
}
```

### B.5 Unit Test Hooks (data layer)

```
apps/bff/test/
  tradeRepo.test.ts       # upsertMany dedupe, cursor paging
  biasRepo.test.ts        # insert/list
  outboxRepo.test.ts      # append/listSince ordering
  tokenSeal.test.ts       # seal/open round-trip, tamper fails
  migrations.test.ts      # ensure schema up
```

### B.6 Migration & Seed Scripts (sketch)

#### prisma/migrations/\*/migration.sql

* Create tables & indexes per entities; monthly partitions for `EventOutbox`.

#### prisma/seeds/seedTrades.ts

```ts
// load OHLCV from seedOHLCV.json
// create demo user → insert trades across 30 days with a few spikes/dips
```

### B.7 Notes & Gotchas

* Use `Decimal` for money fields; format at UI, not DB.
* All timestamps in UTC; store ISO at API boundaries; convert for chart labels on client.
* Keep `features` in `BiasTag` small (only what’s needed for explainability + prompt).
* Add FK constraints where safe; workers may do high‑volume inserts → batch in transactions.

---

**Next:** If this looks good, I’ll produce **Part C — Stack 1: BFF/API** with its own project structure tree, file‑by‑file pseudocode (routes, services, WS relay, middlewares), and test entry points. We'll reuse the entities above verbatim.
