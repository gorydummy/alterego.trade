# Architectural Decision Records (v0.2)

Status key: **Accepted** (final for MVP), **Proposed** (pending validation), **Deprecated** (superseded).

Date: 2025‑09‑04 (Asia/Singapore)

---

## ADR‑001 — Event Log Storage & Delivery

**Status:** Accepted

### Context

UI needs near‑real‑time events (chat reflections, import progress, weekly digest) with **recoverability** on reconnect and **auditability**. Jobs run asynchronously via queues; HTTP must stay stateless and fast.

### Decision

Use a **PostgreSQL transactional outbox** as the **system of record** for UI‑facing events, with a **relay worker** that fans out to WebSocket clients and **Redis** for transient delivery/caching.

* **Write path:** Workers that create user‑visible effects (e.g., `score.bias`, `digest.weekly`, `import.trades`) persist an event row in `event_outbox` within the same transaction as domain changes (e.g., `BiasTag` insert).
* **Relay:** A dedicated relay polls the outbox (or uses `LISTEN/NOTIFY`) and pushes to connected sockets; it also writes a short‑TTL copy to Redis keyed by `eventId` for quick replay.
* **Recovery:** Clients reconnect with `lastEventId`; server queries `event_outbox` (and Redis for hot items) to backfill in order.

### Schema (sketch)

```sql
create table event_outbox (
  id           varchar(26) primary key, -- ULID
  user_id      varchar(26) not null,
  type         text not null,           -- 'coach.reflect' | 'import.progress' | 'digest.ready'
  v            smallint not null default 1,
  ts           timestamptz not null default now(),
  payload      jsonb not null,
  delivered_at timestamptz
) partition by range (ts);
-- monthly partitions for retention & faster scans
```

### Delivery semantics

* **At‑least‑once** to clients; UI deduplicates by `id`.
* **Backpressure:** bounded per‑socket queue; overflow triggers `synced=false` hint; client then fetches `/api/events?since=:id`.
* **Versioning:** `v` incremented on additive payload changes; never remove required keys.

### Alternatives considered

* **Redis Streams as source of truth:** fast append/read, but weaker durability/operational overhead (AOF/RDB tuning, failover).
* **Kafka:** strong decoupling and retention but heavy for MVP and adds infra drag.
* **Direct push only (no log):** simplest, but no recovery guarantees.

### Consequences

* Simple local/dev; production durability via Postgres.
* Queryable history enables auditing and analytics.
* Requires periodic partition maintenance and vacuum.

### Related features

Chat reflections, import progress UI, digest notifications, event replay on reconnect, observability metrics for event latency.

---

## ADR‑002 — First Broker Integration

**Status:** Accepted

### Context

We need one broker for MVP to fetch 30‑day trade history with a **revocable**, **read‑only** integration that builds **user trust** and eases compliance.

### Decision

Start with **Coinbase Advanced Trade** (OAuth 2.0) as the primary adapter. Ship **Binance (API‑key)** behind a feature flag as the secondary option.

**Why Coinbase first**

* **OAuth revocation UX** improves trust (users can revoke from broker).
* Clear **read‑only scopes** and standardized OAuth flows.
* Better alignment with a security‑by‑default narrative for an MVP.

**Binance (flagged)**

* API key + secret stored server‑side (encrypted).
* Broader user base in some regions; useful for pilot diversity.
* Enabled only for invited testers initially.

### Consequences

* Faster secure onboarding via OAuth; fewer support issues around key management.
* We still validate on a Binance cohort before public rollout.
* Adapter interface remains broker‑agnostic to allow rapid expansion.

### Alternatives considered

* Start with Binance: larger crypto share but API‑key management increases perceived risk and support load.
* Start with equities (Robinhood/IBKR): more complex onboarding, longer approval cycles, slows MVP.

### Related features

Broker connect flow, import jobs, OHLCV sourcing (initially from broker where feasible), audit events, rate limiting/backoff.

---

## ADR‑003 — Service‑to‑Service Authentication (BFF ↔ ML)

**Status:** Accepted (phase‑in)

### Context

BFF calls a Python ML service for indicators, bias scoring, and NLG helpers. We need **request authentication and integrity**, low operational complexity for MVP, and a path to **strong mutual identity** later.

### Decision

Phase 1 (MVP): **HMAC‑signed requests** with short‑lived keys.
Phase 2 (v0.2.1): upgrade to **mTLS** using an internal CA and cert rotation.

**Phase 1 details**

* Headers: `X‑Signature: hex(hmac‑sha256(secret, timestamp + body))`, `X‑Timestamp`, `X‑KeyId`.
* Clock skew window ±5 minutes; reject replays (nonce cache in Redis).
* Keys rotated via KMS; BFF → ML allowlist by IP/security group.

**Phase 2 details**

* Private CA (step‑ca or cloud KMS); issue client/server certs per service.
* Automate renewal with cert‑manager (K8s) or a cron+SIGHUP path (VM).
* Enforce SAN‑based authorization (service identity in cert).

### Consequences

* MVP keeps low friction and observability simple.
* mTLS adds cert lifecycle overhead but strengthens identity and transport security.
* Both phases require payload size limits and rate‑limits to protect ML service.

### Alternatives considered

* **JWT‑based service tokens:** acceptable, but HMAC is simpler and avoids clock drift on token validation if kept request‑scoped.
* **Network isolation only:** insufficient; we still sign each request.

### Related features

Indicator/bias/NLG endpoints, retries/backoff, error handling; security logging of signature failures; runbooks for key/cert rotation.

---

## Implementation Notes & Tasks (tie‑ins)

* **ADR‑001**: create `event_outbox` + monthly partitions; add outbox writer in `score.bias`, `digest.weekly`, `import.trades`; build relay worker; add `/api/events?since` endpoint; implement client resume.
* **ADR‑002**: scaffold `adapter-coinbase` (OAuth), `adapter-binance` (API key, feature flag); add audit events; encrypt tokens; UI copy for revocation.
* **ADR‑003**: implement HMAC middleware on ML service; add client signer in BFF; rotate keys via env/KMS; plan mTLS migration (internal CA, cert distribution).

---

## Review & Revisit

* Revisit **ADR‑002** after first 50 testers to confirm broker priority.
* Revisit **ADR‑001** if event volume > 10k/day/user or replay windows grow; consider Redis Streams or Kafka.
* Upgrade **ADR‑003** to mTLS once deployment platform supports automated cert issuance reliably.

---

## ADR‑004 — Market Data Sourcing (Broker vs Vendor, Caching & Reproducibility)

**Status:** Proposed (accept after integration spike)

### Context

Bias features and simulations require OHLCV. Broker APIs may throttle or differ in granularity; third‑party vendors add cost but improve reliability. We also need reproducibility for audits and weekly reports.

### Decision

1. **Primary source:** Use **broker OHLCV** for symbols traded when quotas/granularity allow.
2. **Fallback vendor:** Add a vendor adapter with **crypto → CoinAPI** and **equities/FX → Alpha Vantage** behind a feature flag.
3. **Caching & snapshots:** Cache OHLCV in Redis (symbol, granularity, window) with TTL; **persist weekly snapshots** (per user/symbol/week) to S3 for reproducible digests and simulations.

### Consequences

* Lower latency and cost when broker data suffices; vendor smooths quota gaps.
* Snapshotting enables deterministic counterfactuals for past periods.
* Slight storage overhead for snapshots; lifecycle policy cleans after 90 days.

### Alternatives considered

* Vendor‑only (simpler, but recurring cost + vendor outages).
* Broker‑only (free, but quotas/granularity gaps and occasional maintenance windows).
* Self‑hosted market data (overkill for MVP).

### Implementation notes

* Define `MarketDataAdapter` interface; select source per request with health/latency scoring.
* Include `source` in cache key and in `features` metadata for transparency.
* Add rate‑limit guards and circuit breakers per source.

---

## ADR‑005 — Rules Schema Evolution & Personalization

**Status:** Accepted

### Context

We need explainable, user‑tunable guardrails now, with a path to personalization later without introducing a complex DSL prematurely.

### Decision

* **Schema v1:** Per‑rule JSON (`kind`, `params`, `active`) validated by Zod; store in `Rule.params`.
* **Evaluation:** At import/scoring time for MVP; future pre‑trade checks optional.
* **Personalization v1.1:** Update thresholds per user using **Bayesian calibration** over rolling windows (e.g., spike threshold that maximizes historical precision/recall). Persist learned value back into `Rule.params` with provenance.

### Consequences

* Keeps rules transparent and editable; avoids opaque ML gates.
* Users see their guardrails evolve with evidence.
* Requires audit trail of threshold changes and a rollback mechanism.

### Alternatives considered

* DSL or rules engine (e.g., json‑logic) now — too heavy; reduces clarity.
* Pure ML classifier — less explainable; harder to build trust.

### Implementation notes

* Add `RuleRevision` table (ruleId, params, reason, ts).
* UI: change badges when personalization updates thresholds; tooltip shows last update evidence.

---

## ADR‑006 — Persona Strategy & LLM Cost/Safety Controls

**Status:** Accepted

### Context

Personas drive engagement but can create scope creep and LLM cost volatility. We need a disciplined approach that preserves tone variety while controlling tokens and safety.

### Decision

* **MVP personas:** Ship **Rational Future Self** only; expose **tone** (supportive/strict) as a user setting.
* **Celebrity clones:** Behind feature flags; modeled as **principle presets** (value, growth, macro) that influence advice framing, not asset calls.
* **Cost controls:** `temperature=0`, short prompts with **feature summaries only**, JSON‑mode outputs, Redis caching keyed by `(features,label,tone,persona)`, **per‑user daily token budget** with soft caps.
* **Safety:** System prompt enforces “behavioral coach, not financial advice”; refuse prescriptive trade calls; profanity/harassment filter applied to outputs.

### Consequences

* Predictable LLM spend; easy to A/B tone without new prompts.
* Clear compliance posture: behavior‑focused, not signals.
* Path to a marketplace later without re‑architecting.

### Alternatives considered

* Full persona marketplace at MVP — distracts from core loop, increases cost.
* Fine‑tuned persona models — premature; templated principles suffice early.

### Implementation notes

* Persona = `{ id, name, principles[], tone }`; merge into prompt context.
* Log `tokens_in/out` per request for budget dashboards; raise UI hint when nearing cap.

---

## ADR‑007 — Idempotency & Rate‑Limiting Strategy (HTTP & Jobs)

**Status:** Accepted

### Context

Imports/simulations can be re‑triggered by users or retries. We need consistent dedupe and fair usage protections.

### Decision

* **HTTP POST idempotency:** Require `Idempotency-Key` header; store hash(body) per user+route with 5‑minute TTL; on repeat, return prior response.
* **Job idempotency:** Deterministic `jobId` based on semantic keys (e.g., `sha256(userId|broker|since|until)` for import).
* **Rate‑limits:** Token‑bucket per IP and per user (as in v0.2); `Retry‑After` header; friendly UI copy on 429.

### Consequences

* Eliminates duplicate imports/sims; reduces load and surprises.
* Slight Redis overhead for key tracking.

### Alternatives considered

* No idempotency header — rely on backend dedupe only (works for jobs but not safe for all POSTs).
* Global IP‑only rate limit — unfair behind NATs.

### Implementation notes

* Middleware in BFF for headers; helpers for computing deterministic job ids; dashboards for 429 rates.

---

## ADR‑008 — Deployment Topology (VM w/ Docker vs Kubernetes)

**Status:** Accepted

### Context

We need a production‑ready deployment that is secure, observable, and simple for a small team. MVP comprises Web (Next.js), BFF (Fastify), ML (FastAPI), Postgres, Redis, and object storage. Traffic is modest; reliability matters.

### Decision

**Phase 1 (MVP): Single VM (staging + prod split) with Dockerized services behind a hardened reverse proxy.**

* Reverse proxy: **Caddy** (auto‑TLS, HSTS preload, HTTP/2, OCSP stapling) or NGINX if team prefers.
* Processes: BFF, Web, ML as separate containers; Postgres/Redis as managed services if available (preferred), else containers with daily backups.
* Process supervision: systemd per compose stack (or `docker compose` via systemd unit) with healthcheck restarts.
* Blue/green: deploy to a new container group, wait for health, then switch.

**Phase 2 (scale):** Evaluate **Kubernetes** (EKS/GKE) once we need horizontal scaling, zero‑downtime migrations, and automated cert/secret rotation at scale.

### Consequences

* Faster to stand up, fewer moving parts.
* Clear migration path to K8s without rewriting apps.
* Requires solid backups, monitoring, and OS patching discipline on VM.

### Alternatives considered

* App platform (Fly/Render/DO Apps): easy but less control over mTLS and private networking.
* K8s now: overkill for MVP; operational burden.

### Implementation notes

* Harden SSH (keys only), fail2ban, unattended‑upgrades, minimal base AMI.
* Non‑root containers, read‑only FS where feasible, seccomp profiles.
* Caddy/NGINX sets CSP/HSTS headers; proxy only HTTPS; WSS upgrade allowed to `/ws/coach`.

---

## ADR‑009 — Secrets Management & Encryption Keys

**Status:** Accepted

### Context

We handle broker tokens and session secrets. We need secure storage, rotation, and encryption for data‑at‑rest keys.

### Decision

* **Application secrets (env):** Use a **managed secrets service** (e.g., AWS SSM Parameter Store or 1Password Secrets Automation / Doppler). CI pulls secrets at deploy time; never commit to repo.
* **Data encryption keys:** **Envelope encryption**: generate per‑tenant data encryption keys (DEKs) for token sealing; encrypt each DEK with **cloud KMS** (KEK). Store encrypted DEK alongside app config; decrypt at boot.
* **At rest:** Broker tokens sealed with AES‑256‑GCM using DEK; nonces are random per record; auth tag verified on each read.
* **Rotation:** Rotate DEKs annually or on incident; re‑seal tokens in background; rotate KEKs via KMS policy.
* **Local/dev:** `sops + age` for `.env` templates; developer keys outside repo.

### Consequences

* Strong protection of tokens and secrets; auditable access via KMS logs.
* Slight boot complexity (DEK unwrap); background rotation job required for re‑sealing.

### Alternatives considered

* HashiCorp Vault: powerful but heavy to operate for MVP.
* Plain env files: insufficient for production.

### Implementation notes

* Add `Keyring` module (wrap/unwrap), `kms` client, and `TokenSeal` util.
* CI: pull secrets -> render env -> deploy -> smoke test; never echo secrets in logs.

---

## ADR‑010 — Testing Strategy & Quality Gates

**Status:** Accepted

### Context

We want confidence without slowing iteration. The system spans web UI, API, jobs, and a Python service.

### Decision

Adopt a **testing pyramid** with explicit gates:

* **Unit tests**:  fast, isolated.

  * Web: React components/hooks with Vitest.
  * BFF: service and repository tests with Jest/Vitest; Zod validations.
  * ML: Pytest for indicators and bias scoring helpers.
* **Contract tests**:  Pact or OpenAPI schema tests between Web ↔ BFF and BFF ↔ ML (JSON schemas).
* **Integration tests**:  spin up BFF with Postgres/Redis (Testcontainers) to validate import/score pipelines.
* **E2E**:  Playwright against broker **stub** service; scenarios from Product Spec §9.
* **Security checks**:  ESLint, TypeScript strict, Bandit/flake8 for Python, `npm audit`, Trivy image scan, CodeQL SAST, dependency review.
* **Performance smoke**:  import 1k trades fixture within SLO on CI runner.

**Quality gates in CI**

* Fail build on any P0/P1 test failure, schema drift, or SAST criticals.
* Require green **E2E Must** scenarios to deploy to staging.
* Block prod deploy if SLO probes fail or migration is unsafe.

### Consequences

* Predictable confidence; fast feedback for most changes.
* Slightly longer CI times due to E2E + containers; acceptable for MVP.

### Implementation notes

* Set up Testcontainers for Postgres/Redis in Node and Python.
* Provide broker stub images and seed fixtures.
* Tag tests by level; run unit + contracts on PR, full suite on merge to main.
