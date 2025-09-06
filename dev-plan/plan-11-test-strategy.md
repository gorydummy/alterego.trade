# 11 — Test Strategy (Unit • Contract • E2E • Ops)

> Scope: S1 (Web-UI), S2 (Edge/BFF), S3 (Core API), S4 (Workers), S5 (AI Coach), Integrations, Data plane. All entities & fields align with **02 — Data & ERD**.

---

## 1) Test Pyramid & Goals

```
               E2E (Playwright)  ← few, user-journey critical
        Contract/API (Pact/Zod)  ← thin but strict boundaries
      Integration (Testcontainers)← each service + real deps
          Unit (Vitest/Jest/Pytest)← many, fast, deterministic
              Static/SAST/Lint    ← always-on gating
```

**Objectives**

* Catch regressions at the boundary (contracts) before E2E.
* Make units deterministic & fast (<100ms each).
* Ensure production-safety with security/ops checks (headers, rate limits, SLO probes).

---

## 2) Test Environments

| Env         | Purpose                                                             | Notes                              |
| ----------- | ------------------------------------------------------------------- | ---------------------------------- |
| **CI**      | Run full suite (units+contracts+selected integrations+UI E2E smoke) | Parallelized; ephemeral containers |
| **Local**   | Developer fast loop                                                 | Stub adapters; seed fixtures       |
| **Staging** | Pre-prod E2E, load & chaos drills                                   | Synthetic brokers/AI behind flags  |

**Testcontainers** (Node & Python): Postgres, Redis, MinIO; ephemeral DB/schema per test run.

---

## 3) Shared Fixtures & Factories

### Data Factories (Node, `@faker-js/faker`)

```ts
// tests/factories.ts
export const fxUser = (o: Partial<User> = {}): User => ({
  id: nanoid(), email: faker.internet.email().toLowerCase(),
  passwordHash: 'argon2id$stub', createdAt: new Date().toISOString(), ...o
});

export const fxTrade = (o: Partial<Trade> = {}): Trade => ({
  id: nanoid(), userId: o.userId!, broker: 'coinbase', extId: faker.string.uuid(),
  symbol: 'BTC-USD', side: 'BUY', qty: 0.1, price: 25000, fee: 1.5,
  ts: new Date().toISOString(), ...o
});

export const fxBias = (o: Partial<BiasTag> = {}): BiasTag => ({
  id: nanoid(), tradeId: o.tradeId!, label: 'FOMO', confidence: 0.78,
  features: { spike_pct: 12.4, window_h: 24 }, createdAt: new Date().toISOString(), ...o
});
```

### OHLCV Golden Fixtures

* `fixtures/ohlcv_btc_1h.json` (≥1000 candles, UTC, continuous)
* `fixtures/trade_examples.json` (cover BUY/SELL, FOMO/PANIC/DISCIPLINE patterns)
* Hash snapshot to assert deterministic AI outputs.

---

## 4) Unit Tests (by Stack)

### S1 Web-UI (Vitest + React Testing Library)

* Components: `ReflectBubble` renders labels & text; `SimulationModal` fetches and shows Δ.
* Stores: reducers are pure/deterministic.
* Utils: `apiClient` CSRF+Idempotency headers; `wsClient` reconnection jitter & resume.

**Example**

```ts
test('apiClient sets CSRF and Idempotency on POST', async () => {
  document.cookie = 'csrf_token=abc';
  fetchMock.mockResponseOnce(JSON.stringify({ ok: true }));
  await post('/trades/import', { since: '2025-08-01' }, 'idem-123');
  expect(fetchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    headers: expect.objectContaining({ 'X-CSRF-Token': 'abc', 'Idempotency-Key': 'idem-123' })
  }));
});
```

### S2 Edge/BFF (Vitest/Jest)

* Middlewares: `sessions` (JWKS cache/rotate), `csrf` (double-submit), `idempotencyRequired`.
* Routes: proxy path & headers (`X-User-Id`, `Idempotency-Key`).
* WS relay: auth on upgrade; backlog replay via Core; fanout registry.

**Example**

```ts
it('rejects mutating request without CSRF', async () => {
  const res = await request(app).post('/trades/import').set('Cookie','session=jwt').send({});
  expect(res.status).toBe(403);
});
```

### S3 Core API (Jest + Testcontainers)

* Auth: `Jwt.sign`/`jwks` shape; session repo.
* Outbox: `append`, `listSince` ordering around equal timestamps.
* Trades: `enqueueImport` deterministic jobId; unique `(userId, broker, extId)`.
* Idempotency: same `Idempotency-Key` returns cached response.

### S4 Workers (Jest + Testcontainers)

* Import: pagination & upsert; progress events content; rate-limit backoff.
* Score: heuristic mapping; outbox reflect payload shape; AI timeouts handled.
* Sim: cache hit/miss; delta math; vendor 429 retry.
* Digest: aggregate counts, streaks; S3 path; outbox `digest.ready`.

### S5 AI Coach (Pytest)

* Indicators: RSI/EMA/BB/ATR numerics vs golden fixtures.
* Heuristics: scenarios for FOMO/PANIC/DISCIPLINE/NEUTRAL with confidences.
* NLG: template interpolation, max length, no “buy/sell” imperatives.
* HMAC: valid/invalid sig; timestamp skew; rate-limit.

---

## 5) Contract Tests (Boundary Safety Nets)

### Schema Contracts (Zod/Pydantic-generated JSON Schema)

* **S1↔S2**: DTOs for REST/WSS events. Validate example payloads and live responses in CI.
* **S2↔S3**: Internal REST & SSE event schema.
* **S4↔S5**: AI requests/responses (Pydantic schemas exported → JSON Schema, validated in Node tests).

### Consumer-Driven Contracts (Pact)

* **Consumers:** S1 (for S2); S2 (for S3); S4 (for S5).
* **Providers:** S2, S3, S5 verify contracts on CI (pact-broker optional).
* Break build on mismatches.

**Example (S2→S3)**

```ts
pact
  .given('user has events')
  .uponReceiving('replay since')
  .withRequest({ method: 'GET', path: '/internal/events', query: { since: '01H...' } })
  .willRespondWith({ status: 200, body: eachLike({ eventId: like('01H...'), type: regex(/coach\.reflect|import\.progress|digest\.ready/), ts: like('2025-09-01T00:00:00Z'), v: integer(), payload: like({}) }) });
```

---

## 6) Integration Tests (Real Deps, Stub Externals)

**Infra via Testcontainers**

* Postgres: run migrations; per-test DB name; teardown drops.
* Redis: ephemeral for BullMQ/cache.
* MinIO: bucket for `digests/` and exports.

**Stub Servers**

* **Broker**: HTTP server for Coinbase endpoints (`/trades?page=…`, 429, 5xx toggles).
* **Vendor Market Data**: OHLCV endpoint with uneven edges to test normalization.
* **AI Coach**: mock FastAPI with deterministic outputs (or run real S5 in test mode).

**Scenarios**

* End-to-end import: enqueue → pages processed → trades in DB → outbox events → replay returns events.
* Score pipeline: new trades → bias tags → reflect events delivered.
* Simulation: cache warm/cold; 429 fallback; compute delta.

---

## 7) E2E (Playwright) — User Journeys

**Smoke (CI)**

1. **Auth flow**: signup → login → dashboard loads.
2. **Connect broker**: mocked OAuth callback → success toast.
3. **Import 30d**: POST import → UI shows progress to 100% (WSS).
4. **Reflect bubble**: receive `coach.reflect` → bubble appears with labels.
5. **Simulation modal**: open, see Δ value and chart placeholder.
6. **Weekly digest**: trigger digest job → card visible.

**Extended (staging)**

* WS reconnect & replay after network drop.
* Idempotency: double-click “Import” → single job result.
* CSRF negative path: mutate without header → friendly error UI.

---

## 8) Performance & Load

* **k6** (Edge/Core REST): login, list trades, POST import.
* **Locust** (optional): WS connection churn; event fanout throughput.

**Targets**

* Edge login p95 ≤ 250ms @ 200 RPS.
* Outbox replay (500 events) ≤ 200ms p95.
* WS fanout: 10k concurrent sockets / node (if infra allows), drop rate \~0.

---

## 9) Chaos & Resilience

* **Toxiproxy** in integration tests:

  * Broker 429/timeout → import retries succeed within budget.
  * Redis restart mid-job → BullMQ resumes; idempotent job IDs prevent duplication.
  * AI Coach down → `score.bias` retries then DLQ; Core serves heuristics-only flag.

---

## 10) Security Tests

* **Edge**

  * CSRF: mutate without header → 403.
  * CORS: disallowed origin blocked.
  * Headers: CSP/HSTS present.
  * JWT: expired/invalid → 401; JWKS rotation test.

* **Core**

  * Idempotency: same key → cached response.
  * DTO strictness: unknown fields rejected.

* **AI**

  * HMAC invalid → 401; skew > 5m → 401; body size > 512KB → 413.

* **Secrets**

  * Ensure `accessEnc`/`refreshEnc` never appear in logs (log scrubbing test).

---

## 11) Data Management in Tests

* **No real tokens.** Adapters read from env only in prod profile; tests inject stubs.
* **Seed data** via factories; truncate tables between tests.
* **Determinism**: freeze time (e.g., `sinon.useFakeTimers`) for latency/event ordering assertions.

---

## 12) CI Pipeline & Gates

**Stages**

1. **Lint/Typecheck**: ESLint/TS, Ruff (Python).
2. **Unit**: Node + Python (parallel).
3. **Contracts**: Generate schemas; Pact verify.
4. **Integrations**: Testcontainers matrix (Core, Workers, AI).
5. **UI E2E Smoke**: Playwright against `docker-compose` stack.
6. **SAST/SCA**: CodeQL, Trivy (images), OSS license scan.
7. **Artifacts**: SBOM, coverage reports, Pact files, docker images (signed).

**Blockers**

* Coverage < **80%** lines overall, < **70%** per package.
* Pact/Schema drift.
* Trivy criticals not waived.
* SLO probes red in post-deploy step.

---

## 13) Coverage Strategy

* Units aim ≥90% within pure logic modules (AI indicators/heuristics, Core repos).
* Contracts count as coverage on I/O boundary code.
* E2E intentionally small; do not chase high % here.

---

## 14) Synthetic Probes (Post-Deploy)

* **Login probe**: 200 <250ms.
* **Import probe**: inject synthetic broker; expect `import.progress` → 100% within 60s.
* **Reflect probe**: write outbox row; Edge WS receives ≤3s.
* **AI probe**: indicators on fixture; hash must match baseline.

---

## 15) Example `docker-compose.test.yml`

```yaml
version: "3.8"
services:
  pg:
    image: postgres:16
    environment: { POSTGRES_PASSWORD: test }
    ports: ["5432:5432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
  minio:
    image: minio/minio
    command: server /data
    environment: { MINIO_ROOT_USER: test, MINIO_ROOT_PASSWORD: testtest }
    ports: ["9000:9000"]
  ai:
    build: ./apps/ai-coach
    environment:
      AI_HMAC_KEY_ID: test
      AI_HMAC_SECRET: secret
  core:
    build: ./apps/core
    depends_on: [pg, redis, minio, ai]
  edge:
    build: ./apps/edge
    depends_on: [core]
  workers:
    build: ./apps/workers
    depends_on: [pg, redis, core, ai]
```

---

## 16) Sample E2E (Playwright) Snippet

```ts
test('import then reflect bubble shows', async ({ page }) => {
  await page.goto('/login'); await loginAs(page, 'u@example.com', 'pw');
  await page.getByTestId('btn-connect-coinbase').click();
  await mockOAuthCallback(page); // test helper
  await page.getByTestId('btn-import').click();

  await expect(page.getByTestId('import-progress')).toHaveText(/100%/i, { timeout: 60_000 });
  await expect.poll(async () => await page.locator('[data-testid="bubble-reflect"]').count()).toBeGreaterThan(0, { timeout: 5_000 });
});
```

---

## 17) Reporting & Flakiness Control

* Retry **E2E** tests up to 2 times; quarantine flaky specs with label & follow-up issue.
* Aggregate **JUnit** + HTML reports; upload Playwright trace artifacts on failure.
* Track **failure rate per test**; prune or refactor chronic offenders.

---

## 18) Open Questions

* Pact broker vs commit contracts to repo? (Start in-repo; promote later.)
* Should we run WS load tests in CI or staging only? (Staging only.)
* Golden fixtures update policy (AI): controlled via PR with reviewer approval.
