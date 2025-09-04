# AI Trading Psychology Coach — Tech Package (Polyrepo)

**Goal:** ship a production-ready MVP that helps traders break bad habits (FOMO/PANIC/etc.) via an AI “trading twin”.
**Architecture:** polyrepo; each deployable has its own repo. Contracts are a versioned package.

---

## Repos (one per deployable)

```
web-ui       # S1 Next.js UI (SSR + SPA)
edge-bff     # S2 Edge/Backend-for-Frontend (Express/Fastify, REST + WS)
core-api     # S3 Domain API (Postgres/Redis, Event Outbox, JWKS)
workers      # S4 BullMQ jobs (import, score, simulate, digest)
ai-coach     # S5 FastAPI (indicators, bias scoring, reflections)
contracts    # Shared Zod DTOs (+ JSON Schemas for Python)
infra        # Terraform (Cloud Run, Neon, Upstash, R2, Cloudflare)
```

> Naming is placeholder—use your org/product prefix if you like (e.g., `twintrade-web-ui`, `acme-core-api`, etc.).

---

## What’s in this folder (Docs Index)

**Foundations**

* `01_high-level-dev-plan.md`
* `02_data-and-erd.md`

**Stacks**

* `03_stack1_web-ui.md`
* `04_stack2_edge-bff.md`
* `05_stack3_core-api.md`
* `06_stack4_workers.md`
* `07_stack5_ai-coach.md`
* `08_integrations.md`

**Ops & Quality**

* `09_observability-ops.md`
* `10_security-playbook.md`
* `11_test-strategy.md`
* `12_deployment-environments.md`
* `12B_provider-mapping-terraform.md`
* `13_ci-cd.md`

**Reference**

* `15_polyrepo-architecture-dev-flow.md`
* `16_polyrepo-change-logs.md`
* (`14_monorepo-dev-flow.md` is reference only)

---

## TL;DR — How code moves (polyrepo)

```mermaid
flowchart LR
  subgraph Service Repo (e.g., edge-bff)
    A[Push to main] --> B[CI: build+test]
    B --> C[Push image :sha]
    C --> D[Auto-deploy STAGING (that service)]
  end

  D --> E{Promote to PROD?}
  E -->|Tag service| F[edge-vX.Y.Z pushed]
  F --> G[Bot opens PR in infra to set edge_image=@sha256:digest]
  G --> H[Review & merge in infra]
  H --> I[Terraform apply → PROD (that service)]
```

* **Staging**: merge to `main` in a service repo → that service deploys to staging.
* **Production**: push a **service tag** (e.g., `edge-v1.5.0`) → an **infra PR** pins the exact built image digest and applies only that service.

---

## Contracts (shared DTOs)

* Package: **`@<scope>/contracts`** (Zod + JSON Schemas).
* **Semver** rules:

  * **MINOR**: additive/backward-compatible (new optional fields, new event types).
  * **MAJOR**: breaking; providers must dual-emit versions for a grace period.
* **Python (AI)**: consumes **JSON Schemas**; generates **Pydantic v2** models at build time.

**Release flow**

1. Tag in `contracts`: `contracts-v0.3.2` (CI publishes NPM + schemas artifact).
2. Renovate/Dependabot opens bump PRs across service repos.
3. Merge → each service redeploys to **staging** with the new contracts.
4. Tag specific services to promote to **prod**.

---

## Environments & Platforms

* **Compute:** Cloud Run (Edge/Core/Workers/AI).
* **DB:** Neon Postgres (serverless).
* **Queues/Cache:** Upstash Redis.
* **Objects:** Cloudflare R2 (digests/exports).
* **CDN/DNS/WAF:** Cloudflare.

See `12_deployment-environments.md` and `12B_provider-mapping-terraform.md` for concrete infra and Terraform inputs.

---

## Security (baseline you must keep)

* **Auth:** JWT (RS256, 15m) in HttpOnly cookie on web; token headers on mobile.
* **CSRF:** Double-submit cookie (`csrf_token` + `X-CSRF-Token`) at Edge.
* **Secrets:** Broker tokens sealed AES-GCM with per-tenant DEK (KMS-wrapped).
* **AI calls:** HMAC (`X-KeyId`, `X-Timestamp`, `X-Signature`), ±5m skew.
* **Headers:** HSTS, strict CSP, Referrer-Policy, Permissions-Policy.
* **Logs:** No PII/secrets; use `userId` only; redact by default.

Full details: `10_security-playbook.md`.

---

## Test Strategy (what must pass)

* **Unit** (Vitest/Jest/Pytest), **Integration** (Testcontainers), **Contract** (Zod/JSON Schema; Pact optional), **E2E** (Playwright), **Ops probes**.
* CI gates (per repo): coverage ≥ 80% overall, schema drift guard, SAST/SCA, contract tests green.
  See `11_test-strategy.md`.

---

## Day-to-day developer flow

**Feature work**

```bash
# in a service repo, e.g., core-api
git checkout -b feat/add-sim-horizon
# ...edit code/migrations...
git commit -m "feat(core): add simple what-if horizon"
git push origin feat/add-sim-horizon
# Open PR → CI → merge → STAGING deploy (core only)
```

**Promote to prod (that service only)**

```bash
git tag core-v0.10.0
git push --tags
# Tag workflow opens PR in infra with the exact image digest
# Merge infra PR → Terraform apply → prod updates Core only
```

**Contracts bump in a service**

```bash
# After Renovate PR lands (e.g., @scope/contracts@0.3.2)
# Merge → STAGING deploy for that service
# When ready:
git tag edge-v1.5.0
git push --tags
```

---

## First-week checklist (polyrepo bring-up)

* [ ] Create the seven repos + branch protection + CODEOWNERS.
* [ ] Enable OIDC to GCP for each service repo and the `infra` repo.
* [ ] Set env secrets per repo (DB URL, Redis, R2, JWT keys, CSRF pepper).
* [ ] Stand up `infra` Terraform with **per-service image variables**:

  * `edge_image`, `core_image`, `workers_image`, `web_image`, `ai_image`.
* [ ] Add **staging deploy** workflow to each service repo (on merge to `main`).
* [ ] Add **tag → infra PR** workflow to each service repo (prod promotion).
* [ ] Publish `@<scope>/contracts@1.0.0` + schemas; enable Renovate across repos.
* [ ] Wire **system E2E** (in `infra`) to smoke-test staging after any service deploy.

---

## Event types (MVP)

* `import.progress` — job status (count/percent).
* `coach.reflect` — bias labels + short narrative.
* `digest.ready` — weekly rollup available.

Schemas: see `contracts` package / `schemas/*.json`.
Storage & relationships: `02_data-and-erd.md`.

---

## Branching & tags

* Branches: `feat/*`, `fix/*`, `chore/*`.
* Service tags (prod): `web-vX.Y.Z`, `edge-vX.Y.Z`, `core-vX.Y.Z`, `workers-vX.Y.Z`, `ai-vX.Y.Z`.
* Contracts tags (publish): `contracts-vX.Y.Z`.

---

## Support files you’ll likely open first

* **Security:** `10_security-playbook.md`
* **Deployment:** `12B_provider-mapping-terraform.md`
* **CI/CD:** `13_ci-cd.md`
* **Core API:** `05_stack3_core-api.md`
* **Workers:** `06_stack4_workers.md`

---

## Glossary

* **BFF**: Backend-for-Frontend, our Edge service in front of Core.
* **Outbox**: DB table for durable, versioned events per user.
* **Dual-emit**: Providers sending both old/new event payload versions during a migration.
* **Artifact promotion**: Reusing the exact image digest from staging in prod (no rebuilds).

---

**Questions / changes?**
Update `16_polyrepo-change-logs.md` and open a PR in this docs repo (or file an issue in `infra`).
