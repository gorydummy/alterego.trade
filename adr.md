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
