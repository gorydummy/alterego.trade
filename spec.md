# AI Trading Twin — Product Spec, User Stories & E2E (v0.2)

> Desktop‑first MVP; production‑ready defaults. This spec translates the v0.2 blueprint into buildable product requirements, user stories with acceptance criteria, and end‑to‑end test cases for feature‑driven development.

---

## 1) Product Overview

**Vision**: An AI “trading twin” that helps traders break emotional habits (FOMO, panic selling) via post‑trade reflection, simple counterfactuals, and weekly coaching — not a trading bot.

**MVP Outcome**: Import 30 days of trades from one broker, tag behavioral biases, deliver chat reflections and a weekly digest, with secure defaults (headers, cookies, encryption, rate‑limits) and observable SLOs.

**Success Metrics (post‑beta)**

* ≥ 30% of active users read the weekly digest within 24h of delivery.
* ≥ 2 coach reflections viewed per active trading day.
* ≥ 15% reduction in FOMO‑tagged entries after 2 weeks (vs baseline).

---

## 2) Personas & Primary Use Cases

**P1. Retail Crypto Trader (Core MVP target)**

* Goals: Stop buying pumps, stop panic selling, build discipline.
* Constraints: Uses Binance/Coinbase; trades from desktop; privacy‑sensitive.

**P2. Retail Equity Trader (Secondary)**

* Similar needs; broker may differ (phase‑in after MVP).

**Primary Use Cases**

1. Connect broker → import past 30d trades.
2. See each trade tagged with likely bias + quick explanation.
3. Ask the twin for a simple what‑if (hold vs actual; wait‑then‑enter).
4. Receive a weekly digest with bias impact and one micro‑challenge.
5. Set a simple rule (e.g., avoid spike entries > X%) and track streaks.

---

## 3) Scope (In / Out)

**In**: 1 broker adapter; read‑only imports; heuristic bias tags; simple simulations; weekly digest; rules (limited); WS reflections; export/delete account; secure defaults.

**Out**: Order placement; multi‑broker aggregation; advanced backtesting; mobile apps; persona marketplace (beyond “Rational Self” tone switch).

---

## 4) Core User Flows

### 4.1 Onboarding & Broker Connect

1. Sign up/login with email+password; secure cookies; CSRF protection.
2. Start broker connect → OAuth (Coinbase AT) or API‑key flow (Binance) with state/PKCE; callback persists encrypted tokens; audit entry.
3. Prompt to import last 30 days.

**A/C (high‑level):** See AUTH‑01, BRO‑01 stories below.

### 4.2 Import & Normalization

1. User clicks “Import 30d” → POST `/api/trades/import` → 202.
2. Job fetches pages, normalizes, dedupes by `(userId, broker, extId)`.
3. Progress events over WS; UI shows progress bar.

### 4.3 Bias Tagging & Reflection

1. For each trade, compute features & heuristics → create `BiasTag`.
2. Emit `coach.reflect` over WS; UI shows chat bubble with mini chart and CTA buttons (“Open Simulation”, “Compare to Rational Self”).

### 4.4 Simulation

1. User opens simple counterfactual panel.
2. Server computes Hold vs Actual (and simple wait‑then‑enter); returns JSON sparkline + delta P/L.

### 4.5 Weekly Digest

1. Scheduled job aggregates week (counts by bias, P/L attribution, streaks).
2. Store `Digest` and push `digest.ready` event; UI shows digest card.

### 4.6 Rules & Streaks

1. User sets rule `avoidSpikeOverPct = 10`.
2. When new trades violate rule → insight created; streak resets.

### 4.7 Settings & Privacy

* View data policy; export data (JSON/CSV); delete account.

---

## 5) Functional Requirements (FR) & Non‑Functional (NFR)

**FR‑01 Auth**: Email+password; session cookies (HttpOnly/Secure/SameSite=Lax); CSRF on mutating endpoints.
**FR‑02 Broker Connect**: OAuth/API‑key; token encryption at rest; audit events.
**FR‑03 Import Trades**: 30d window; pagination; dedupe; idempotent by time window.
**FR‑04 Bias Tagging**: Heuristics per v0.2; store `features`; confidence 0‑1.
**FR‑05 Coach Reflections**: WS push on new tags; concise natural‑language explanation.
**FR‑06 Simulations**: Hold vs Actual; optional wait‑then‑enter; cache results.
**FR‑07 Weekly Digest**: Aggregate stats; one micro‑challenge suggestion.
**FR‑08 Rules & Streaks**: CRUD rules; evaluate on imports; streak counters.
**FR‑09 Export/Delete**: User can export trades + tags; delete account (hard‑delete tokens, soft‑delete trades OK for 7‑day retention if declared).
**FR‑10 Observability**: Logs, metrics, traces per v0.2.

**NFR‑01 Security Headers**: CSP, HSTS, Referrer‑Policy, Permissions‑Policy, XFO/CTO.
**NFR‑02 Rate Limits**: Per endpoint defaults (see v0.2); graceful 429 UX.
**NFR‑03 Performance**: Imports ≤60s (p95) for ≤1k trades; WS reflect ≤500ms (p50).
**NFR‑04 Privacy**: PII minimization; encrypted tokens; no raw IP storage.
**NFR‑05 Reliability**: At‑least‑once coach events; recover missed by `lastEventId`.

---

## 6) Data & API Contracts (reference)

* Entities: `User`, `Session`, `BrokerConnection`, `Trade`, `BiasTag`, `Digest`, `Rule`, `Audit` (see v0.2 schema).
* Key DTOs: `TradeDto`, `BiasTagDto`, `SimulationRequest`, `CoachEvent` (see v0.2 Zod examples).

---

## 7) Definition of Done (DoD) & Acceptance (Global)

* Meets FR/NFR; headers verified; rate‑limit behavior tested; CSRF verified.
* DB migrations applied; Prisma seed for test fixtures.
* E2E tests green in CI (Playwright) using broker stub.
* Logs/metrics/traces visible in dev dashboard; SLO probes passing.
* Security review: secrets not logged; tokens encrypted; audit entries present.

---

## 8) User Stories w/ Acceptance Criteria (Gherkin)

### AUTH‑01: Sign Up & Login (Must)

**Story**: As a user, I can create an account and log in securely.
**A/C**

* **Given** I submit valid email/password **when** I sign up **then** my session cookie is set (HttpOnly/Secure/SameSite=Lax) and an `Audit: login` is recorded.
* **Given** I am logged in **when** I refresh **then** I remain authenticated.
* **Given** I send a POST without CSRF token **then** I receive 403.
* **Given** I exceed 10 auth requests/min **then** I receive 429 with retry‑after.

### BRO‑01: Connect Broker (Must)

**Story**: As a user, I can connect my broker read‑only.
**A/C**

* **Given** I start connect **then** I’m redirected to broker OAuth with `state`+PKCE.
* **Given** callback returns code **then** tokens are stored encrypted and status set `active` with an audit.
* **Given** I tamper `state` **then** callback is rejected and audited as `auth_fail`.

### TRD‑01: Import 30d Trades (Must)

**Story**: As a user, I can import my last 30 days of trades with progress.
**A/C**

* **Given** I click Import **then** API responds 202 with job id and a WS `import.progress` stream shows percent.
* **Given** duplicate broker trade ids **then** only one `Trade` is stored (unique on `(userId, broker, extId)`).
* **Given** I re‑trigger import with same window **then** job is deduped (idempotency).

### BIAS‑01: Tag Trades (Must)

**Story**: As a user, I see each trade tagged with likely bias and a short explanation.
**A/C**

* **Given** a trade **then** `BiasTag` is created with `label`, `confidence`, and `features` persisted.
* **Given** tag is created **then** `coach.reflect` event arrives ≤500ms p50 with short text and mini chart data.

### CHAT‑01: Coach Reflection Interaction (Should)

**Story**: As a user, I can ask my twin to run a what‑if or change tone.
**A/C**

* **Given** I tap “Open Simulation” **then** a panel opens with Hold vs Actual deltas.
* **Given** I change tone to “Rational Self” **then** subsequent reflections use that tone.

### SIM‑01: Simple Counterfactuals (Must)

**Story**: As a user, I can see Hold vs Actual, optionally wait‑then‑enter.
**A/C**

* **Given** I request simulation **then** server returns JSON with both curves and net delta; cached for same params.
* **Given** market data vendor throttles **then** UI shows a retry hint and no spinner lock.

### DIG‑01: Weekly Digest (Must)

**Story**: As a user, I receive a weekly summary and a single actionable challenge.
**A/C**

* **Given** a weekly job runs **then** a `Digest` is stored and `digest.ready` WS event sent.
* **Given** I open the digest **then** I see counts by bias, P/L attribution, streaks, and one suggested rule.

### RUL‑01: Rules & Streaks (Should)

**Story**: As a user, I can set a simple rule to avoid spikes and track streaks.
**A/C**

* **Given** I set `avoidSpikeOverPct=10` **then** new imports violating it create an insight and reset streak.
* **Given** I pause a rule **then** violations are not generated.

### PRIV‑01: Export/Delete (Must)

**Story**: As a user, I can export my data and delete my account.
**A/C**

* **Given** I export **then** I receive a downloadable JSON/CSV within 1 minute for ≤10k trades.
* **Given** I delete **then** access is revoked, tokens destroyed, and a final audit is recorded.

### SEC‑01: Security Headers & Cookies (Must)

**Story**: As a platform owner, I enforce secure headers and session policies.
**A/C**

* **Given** any HTML response **then** CSP/HSTS/Referrer‑Policy/Permissions‑Policy/XFO/CTO headers are present with expected values.
* **Given** session cookie **then** it is HttpOnly/Secure/SameSite=Lax with reasonable TTL and rotation on login.

### OBS‑01: Observability & SLOs (Must)

**Story**: As an operator, I can observe health and meet SLOs.
**A/C**

* **Given** import runs **then** metrics for duration, pages, and rate‑limit hits are captured; p95 ≤ 60s on 1k trades.
* **Given** coach events flow **then** WS latency p50 ≤ 500ms is visible on dashboard.

---

## 9) E2E Test Plan (Playwright + Broker Stub)

**Environment**: `docker compose up` (Postgres, Redis, MinIO) + BFF + ML + **Broker Stub Service** (simulates OAuth + trades + OHLCV). Feature flags enabled for stub in test.

**Conventions**: data‑testids on key UI controls (`data-testid="btn-import"`, `panel-sim`, `chart-mini`, etc.).

### E2E‑001 Sign Up / Login

* Create account → assert `Set‑Cookie` flags; reload → still logged in; logout → cookie cleared.
* Negative: missing CSRF on POST → 403.

### E2E‑002 Broker Connect (OAuth happy path)

* Start connect → redirected to stub OAuth with `state` param.
* Finish callback → DB has encrypted tokens; audit row created.
* Negative: tampered state → 400 + audit `auth_fail`.

### E2E‑003 Import 30d (Progress & Dedupe)

* Click Import → 202; WS progress reaches 100%; list shows N trades.
* Trigger import again with same window → deduped; no new trades stored.

### E2E‑004 Bias Tagging & Reflection Event

* After import, await `coach.reflect` event; chat shows bubble with bias label and mini chart.
* Assert payload JSON schema.

### E2E‑005 Simulation (Hold vs Actual)

* Open simulation from chat; assert presence of two curves + delta value.
* Refresh page → cached result loads fast (<300ms).

### E2E‑006 Weekly Digest

* Trigger digest job (test hook) → UI shows digest card; open and validate counts by bias and suggested challenge.

### E2E‑007 Rules & Streaks

* Set rule `avoidSpikeOverPct=10`; import fixture trades with spike entries → violation insight visible; streak reset.
* Pause rule → import same fixtures → no new violations.

### E2E‑008 Security Headers & Cookies

* Fetch a page and assert exact header values for CSP/HSTS/etc.
* Inspect cookies → HttpOnly/Secure/SameSite present; no `localStorage` auth artifacts.

### E2E‑009 Rate Limits (429 UX)

* Burst `POST /api/simulations/simple` >10/min → receive 429; UI shows graceful message.

### E2E‑010 WS Reconnect & Recovery

* Force socket drop → client reconnects with `lastEventId`; missed events replayed.

### E2E‑011 Data Export / Delete

* Request export → download created; validate minimal schema.
* Delete account → subsequent API calls 401; audit entry recorded.

**Fixtures**

* **Trades‑Small.json**: 12 trades (3 FOMO, 3 Panic, 6 Discipline) across 30 days.
* **OHLCV‑Seed.json**: deterministic candles for BTC/ETH/SOL; spike & dip windows.
* **Users.csv**: test users (emails/passwords) for auth scenarios.

---

## 10) Feature‑Driven Delivery Slices

1. AUTH‑01 + SEC‑01 basics → 2) BRO‑01 with stub → 3) TRD‑01 import & progress → 4) BIAS‑01 tagging + CHAT‑01 reflection → 5) SIM‑01 hold vs actual → 6) DIG‑01 weekly digest → 7) RUL‑01 rules & streaks → 8) PRIV‑01 export/delete → 9) OBS‑01 dashboards → 10) NFR polish & perf.

---

## 11) Release Criteria (Go/No‑Go)

* All **Must** stories pass E2E.
* Security headers verified in staging via automated check.
* Import SLO p95 ≤ 60s on 1k trades with stub → smoke test on real broker (≤ 500 trades) succeeds.
* WS reflect p50 ≤ 500ms in staging.
* No P0/P1 defects open.

---

*End of v0.2 Product Spec.* Ready to generate repo scaffolding and start implementing slice by slice with test‑first E2E where applicable.
