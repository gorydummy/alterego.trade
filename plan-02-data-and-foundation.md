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

---

## Part C — Stack 1: BFF / API (Fastify + Prisma + BullMQ + WebSocket)

> Goal: Orchestrate auth, broker connect, import pipeline, bias tagging, simulations, weekly digest, and UI event delivery with **production‑ready** security.

### C.1 Architecture & Flow Diagrams

**Context Diagram (ASCII)**

```
[Web App]
   │  REST (HTTPS) + WS (WSS)
   ▼
[BFF/API  (Fastify)] ─────────────────────────────────────────────┐
   │        │         │           │                               │
   │        │         │           │                               │
 Postgres  Redis   BullMQ Qs   Python ML (FastAPI)           Broker APIs
  (Prisma) cache    (workers)    HMAC→mTLS path             (Coinbase/flag Binance)
   │        │         │           │                               │
   └── Event Outbox → WS Relay → UI (coach.reflect / progress / digest.ready)
```

**Key Sequences**

1. **Broker Connect (OAuth)**

```
Web → BFF: start
BFF → Broker: redirect (state+PKCE)
Broker → BFF: callback(code)
BFF: exchange → seal tokens → Audit → 200
```

2. **Import → Score → Reflect**

```
Web → /trades/import (Idempotency-Key) → 202 (jobId)
Worker(import): fetch pages → normalize → upsert → emit import.progress
Worker(score): features+heuristics → BiasTag → Outbox(coach.reflect)
WS Relay: push reflect events; client can replay via /events?since
```

3. **Simulation**

```
Web → /simulations/simple
BFF: market data (broker/vendor) + cache → JSON curves → 200
```

4. **Digest**

```
Cron → digest.weekly job → aggregate → store Digest → Outbox(digest.ready) → WS push
```

---
