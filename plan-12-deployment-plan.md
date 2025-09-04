# 12 — Deployment & Environments (Low-Cost → Scalable)

## Objectives

* **Keep burn low** today (developer-friendly, minimal ops).
* **Scale smoothly** (horizontal where possible, swap-out components without rewrites).
* **Security-first** (TLS, secrets, backups, least privilege).
* **Fast CI/CD** (small, reversible releases; canary/cutover).

---

## Environment Matrix

| Env         | Purpose             | Isolation      | Deploy Trigger | Data                                |
| ----------- | ------------------- | -------------- | -------------- | ----------------------------------- |
| **Dev**     | Developer testing   | Shared sandbox | Every PR build | Ephemeral DB, seeded                |
| **Staging** | Pre-prod end-to-end | Prod-like      | Main branch    | Masked production replicas (no PII) |
| **Prod**    | Live traffic        | Dedicated      | Tagged release | Real data, backups enabled          |

---

## Recommended Topology (start small, scale later)

### Option A — **Single VM (Docker Compose)** *(cheapest, fastest to start)*

* 1 small VM (2 vCPU / 4–8 GB RAM) running:

  * **S2 Edge**, **S3 Core**, **S4 Workers**, **S5 AI Coach** as containers
  * **Caddy/Traefik** reverse proxy (TLS + HTTP/2 + WebSockets)
  * **Redis** (queue + cache)
  * **Postgres** (on the VM disk; weekly offsite backups)
  * **MinIO** (S3-compatible) for digests/exports
* Pros: ultra low cost, simple.
* Cons: single point of failure; limited autoscale; ops on you.
* Scale path: move Postgres to managed; split workers to a second VM; add a standby VM + keepalived.

### Option B — **Serverless Containers + Managed Data** *(low ops, elastic — recommended)*

* **Edge/Core/Workers/AI** as **container services** (autoscale on CPU/requests).
* **Managed Postgres** (serverless or small dedicated).
* **Managed Redis** (serverless compatible with BullMQ).
* **Object storage** (S3-compatible).
* **Cloud CDN/DNS** in front (handles TLS and caching).
* Pros: great price–performance at low scale, bursts handled; minimal ops.
* Cons: per-request cold starts for seldom-used services (mitigate with min instances).
* Scale path: raise min instances, split workers into separate autoscaling service, add read replicas for Postgres.

### Option C — **Lightweight K8s (K3s) on 2–3 VMs** *(cost-efficient steady load)*

* 2–3 small VMs (control-plane + workers).
* Helm charts for **Edge**, **Core**, **Workers**, **AI**.
* **Managed Postgres**, **Managed Redis**, **Managed S3** still external.
* Pros: horizontal scale with bin-packing; cost-efficient once traffic is steady.
* Cons: ops overhead (upgrades, certs, ingress).

> **Recommendation:** Start with **Option B** for production (serverless containers + managed data). Keep **Option A** for dev/staging or local demos.

---

## High-Level Diagram

```mermaid
flowchart LR
  subgraph Client
    U[Browser (S1)] -- HTTPS/WSS --> CDN
  end

  subgraph EdgePlane
    CDN[CDN/DNS/TLS] -- HTTPS --> E[S2 Edge/BFF]
    E -- mTLS/private --> C[S3 Core API]
    E -. WSS .- U
  end

  subgraph App
    C -- REST --> AIC[S5 AI Coach]
    C -- Enqueue --> W[S4 Workers]
    W -- REST/HMAC --> AIC
  end

  subgraph Data
    PG[(Managed Postgres)]
    R[(Managed Redis)]
    S3[(Object Storage)]
  end

  C <---> PG
  C <---> R
  W <---> PG
  W <---> R
  W --> S3
```

---

## Component Placement (Option B)

* **S2 Edge/BFF**: container app (2 replicas min for HA), public ingress, sticky cookies enabled.
* **S3 Core API**: container app (1–2 replicas), private ingress only.
* **S4 Workers**: separate container app, horizontal autoscale by queue depth (BullMQ metrics).
* **S5 AI Coach**: container app (1 min instance), private only.
* **Postgres**: managed (single AZ to start; enable automated backups + PITR).
* **Redis**: managed serverless or small dedicated plan (AOF disabled; persistence not required).
* **Object Storage**: S3-compatible bucket with server-side encryption; lifecycle rules (move to IA after 30 days).
* **CDN/DNS**: fronting Edge with TLS certs, HTTP/2/3, WAF rules.

---

## Scaling Triggers & Levers

| Symptom                  | SLI/Metric                          | Action                                                                              |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------- |
| **High reflect latency** | `event_delivery_lag_ms p95 > 3s`    | Scale **Workers/score** concurrency; bump Redis size; enable AI Coach min instances |
| **Import backlog**       | `queue_depth(q_import) > threshold` | Increase Workers/imp replicas; reduce per-user import window; add broker backoff    |
| **Core saturation**      | `p95 http > 250ms` or CPU > 70%     | Add Core replica; enable connection pooling; add read replica if needed             |
| **Edge 5xx**             | Availability dip                    | Add Edge replica; raise connection limits; enable autoscaling on concurrent conns   |
| **DB pressure**          | `pg_locks`, CPU > 70%               | Upgrade instance; add read replica (for reporting), ensure indexes/partitioning     |
| **Redis evictions**      | `evictions_total > 0`               | Increase memory; raise TTLs; shard hot keys                                         |

---

## CI/CD Pipeline

1. **Build**: Docker images per stack with pinned runtimes; SBOM + vulnerability scans.
2. **Test**: Run unit/contract/integration (see §11), E2E smoke against `docker-compose.test.yml`.
3. **Publish**: Push images to registry (signed with Cosign).
4. **Deploy**:

   * **Dev/Staging**: auto on merge to main.
   * **Prod**: tag release → canary 10% traffic for 30 min → auto promote if SLO probes pass.
5. **Migrations**:

   * `prisma migrate deploy` gated by maintenance window in prod.
   * Expand → backfill → contract pattern; backward-compatible releases.

---

## Secrets & Config

* **Secrets**: provider’s secret store or a secrets manager (scoped per environment); never in repo.
* **Runtime config**: via env vars (twelve-factor).
* **Key material**: JWT signing key in KMS/HSM; DEK rewrap schedule (quarterly).
* **AI HMAC**: rotate `AI_HMAC_SECRET` regularly; dual-publish for seamless rotation.

---

## Backups & DR

* **Postgres**: daily full + WAL; retain 14–30 days; monthly restore drill.
* **Redis**: no persistence required; warm caches after restart.
* **S3**: versioning on; lifecycle to IA/Glacier; bucket policy private.
* **Runbooks**: restore-from-backup docs (RTO ≤ 4h, RPO ≤ 15m).

---

## Network, TLS, Domains

* **Domains**: `app.example.com` → Edge; `api.internal` (private) → Core; `ai.internal` → AI Coach.
* **TLS**: CDN terminates; mTLS or private networking between Edge/Core/AI.
* **Firewall**: allowlist only provider CIDRs; Core/AI not publicly routable.
* **WebSockets**: ensure CDN supports HTTP/2/3 and WSS pass-through; sticky if needed.

---

## Cost Levers (keep cheap now)

* Keep **min instances = 1** for Core/AI; **Edge = 2** small replicas for HA.
* Use **serverless Postgres** or smallest managed instance; bump storage IOPS only when needed.
* Use **serverless Redis** plan sized by ops/sec; keep TTLs tight (1h for simulations).
* Store digests in S3; keep only **latest** weekly digest in DB.
* Prefer **single region** to start; multi-region later for WS proximity.

---

## Promotion Strategy

* **Feature flags**: `HEURISTICS_ONLY`, `FEATURE_VENDOR_FALLBACK`, `FEATURE_BINANCE`.
* **Blue/Green**: two revisions for Edge and Core; switch traffic at CDN.
* **Rollbacks**: image tag rollback + schema compatibility ensures instant cutback.

---

## Terraform/Pulumi Skeleton (Option B)

```
infra/
  modules/
    container_service/
      main.tf           # image, autoscale policy, health checks
    postgres/
      main.tf           # size, backups, pitr, users
    redis/
      main.tf           # plan, eviction policy
    bucket/
      main.tf           # lifecycle, versioning, sse
    dns_cdn/
      main.tf           # domain, cert, WAF rules
  envs/
    dev/
      main.tfvars
    staging/
      main.tfvars
    prod/
      main.tfvars
```

**Autoscale policies**

* Edge: scale on concurrent connections & CPU.
* Core: scale on p95 latency & CPU.
* Workers: scale on queue depth (custom metric from BullMQ).
* AI Coach: scale on RPS & CPU.

---

## Health & SLO Probes (Gate deploys)

* **Login probe**: GET `/auth/me` with cookie in <250ms p95.
* **Reflect probe**: write synthetic outbox row; expect WS delivery <3s.
* **Import probe**: enqueue synthetic job; progress hits 100% <60s.
* **AI probe**: indicators on fixture; hash stable.

---

## Migration Path (when traffic grows)

1. **Data tier first**: move from serverless Postgres → dedicated (more RAM/IOPS), add read replica for analytics/exports.
2. **Workers**: split queues into dedicated services (import/score/sim/digest), shard by user hash.
3. **Events**: switch Outbox polling → **LISTEN/NOTIFY**; consider Redis pub/sub as cache.
4. **Edge multi-region**: add a second region close to users; sticky sessions at CDN; WS fanout regionally.
5. **K8s** (if needed): move container apps to a managed cluster; keep managed DB/Redis/S3.

---

## Region & Timezone

* Primary users are Asia-based; choose a **Southeast Asia region** to minimize WS latency.
* Keep all stateful services (Postgres/Redis/S3) **co-located** with compute to avoid cross-region egress/latency.

---

## Security Guardrails (Prod)

* Edge: CSP/HSTS/Referrer-Policy/Permissions-Policy; rate limits; CSRF enforced.
* Core: JWT on every call; Idempotency-Key for POST; audit log writes.
* Workers: bounded retries + DLQ; secrets never logged; off-by-default vendor fallback.
* AI: HMAC, body size cap, deterministic outputs.

---

## Go-Live Checklist

* [ ] DNS cutover with low TTL & warm canary revision.
* [ ] Postgres backups tested; PITR enabled.
* [ ] Redis metrics dashboard shows 0 evictions during load test.
* [ ] SLO probes green for 30 min at 10% canary.
* [ ] Feature flags default to safest paths (`HEURISTICS_ONLY=true` as kill switch).
* [ ] Runbooks accessible; on-call rotation set.

---

## Rollback Plan

* **App rollback**: revert container image tags; invalidate CDN cache if needed.
* **Schema rollback**: only after expand→migrate→contract completes; otherwise disable new code paths via feature flags.
* **Config rollback**: previous Terraform state; keep last 3 revisions.

---

## Open Decisions

* Pick exact providers (we can map this topology to multiple clouds).
* Choose **serverless vs small dedicated** Postgres/Redis based on spike patterns.
* Multi-region target & data residency (if/when required).

---
