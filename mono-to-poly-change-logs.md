# Polyrepo Change Logs (from Technical Solution → Roadmap & Dev Plan)

> Convention used below:
>
> * **Repos** (polyrepo):
>   `web-ui`, `edge-bff`, `core-api`, `workers`, `ai-coach`, `contracts`, `infra` (rename as you like).
> * **Service tags (prod)**: `web-vX.Y.Z`, `edge-vX.Y.Z`, `core-vX.Y.Z`, `workers-vX.Y.Z`, `ai-vX.Y.Z`.
> * **Contracts package**: `@<scope>/contracts` (Zod + JSON Schemas).

---

## Doc 01 — High-Level Development Plan

**Changed**

* Architecture references updated from **monorepo** to **polyrepo** (one repo per deployable + `contracts` + `infra`).
* Release flow: staging auto-deploy **per repo** on merge to `main`; production deploys via **service-specific tags**.
* Ownership/RACI: each repo maps to a clear **codeowner** team.

**Added**

* Cross-repo coordination: **Renovate/Dependabot** to bump `@<scope>/contracts` in all service repos.
* “Artifact promotion” rule: prod always uses the **same image digest** built from `main` (no rebuilds).
* A small **“system E2E” job** hosted in `infra` to smoke test staging after any service deploy.

**Removed**

* Monorepo build graph (Turbo/Nx) as a central requirement (teams may still use Nx/Turbo **inside** a repo if helpful).

**Action required**

* Create seven repos; enable branch protection; define CODEOWNERS; set up required status checks.

---

## Doc 02 — Data & ERD

**Changed**

* Schema authority remains the same; **type definitions** now distributed via `@<scope>/contracts` instead of a workspace package.
* Event type/version table unchanged; **event payload JSON Schemas** come from the published contracts artifact.

**Added**

* “Contracts version pin” note: each service must pin a contracts **semver** and upgrade via PR.

**Removed**

* Any path examples referring to `packages/contracts` inside a monorepo.

**Action required**

* Update all imports to `@<scope>/contracts`.
* Ensure the AI repo pulls **JSON Schemas** (not TS) for codegen.

---

## Doc 03 — Stack 1: Web-UI (Next.js)

**Changed**

* CI in `web-ui` builds/pushes Docker image on merge to `main`; auto-deploys **only Web-UI** to staging.
* Uses `@<scope>/contracts` from registry.

**Added**

* Release via tag `web-vX.Y.Z` (GH Action in `web-ui` opens/update PR in `infra` to bump the **web** image digest for prod).

**Removed**

* Any monorepo workspace linking steps.

**Action required**

* Set env secrets in `web-ui` repo (public API base, WS URL, etc.).
* Ensure CSP/headers still enforced by Edge (unchanged functionally).

---

## Doc 04 — Stack 2: Edge/BFF (Express/Fastify)

**Changed**

* Repo: `edge-bff` owns REST/WS, CSRF, idempotency, fan-out.
* Staging deploy on merge; prod via `edge-vX.Y.Z` tag.

**Added**

* GH Action to send a **“promote” PR** to `infra` when `edge-v*` is pushed.

**Removed**

* Monorepo-specific proxy/dev wiring.

**Action required**

* Configure JWKS URL, cookie keys, CSRF pepper in `edge-bff` repo secrets.

---

## Doc 05 — Stack 3: Core API

**Changed**

* Core holds **DB migrations** solely within `core-api` repo.
* Staging auto-runs `migrate deploy` on release to staging; prod via `core-v*` tag.

**Added**

* “Expand→backfill→contract” checklist enforced in `core-api` CI.
* Contract tests (provider) against `@<scope>/contracts` **pinned** version.

**Removed**

* Any reference to centralized migrations in a monorepo.

**Action required**

* Seed script & Testcontainers config stay in repo; wire DB URL from `infra` outputs.

---

## Doc 06 — Stack 4: Workers

**Changed**

* `workers` repo owns queue processors; builds & deploys **independently**.
* Uses `@<scope>/contracts` pinned version.

**Added**

* Auto-scale policy remains infra-side; CI publishes image per merge; prod tag: `workers-v*`.

**Removed**

* Monorepo task orchestration references.

**Action required**

* Secrets: Redis URL, Core internal base, S3 creds (from `infra`) stored in repo secrets.

---

## Doc 07 — Stack 5: AI Coach (FastAPI, Python)

**Changed**

* Contracts intake now via **JSON Schemas artifact** for the pinned `@<scope>/contracts@X.Y.Z`.
* CI step runs **datamodel-code-generator** to emit Pydantic v2 models on every build.

**Added**

* Tag `ai-v*` for prod promotion; staging auto-deploy on merge.

**Removed**

* Any assumption of workspace shared TS types.

**Action required**

* Add step to **download schemas artifact** (from NPM pkg tarball or GH Release asset) before codegen.

---

## Doc 08 — Integrations: Broker & Market Data

**Changed**

* No functional change; env/feature flags are now **per-repo** secrets (Edge/Core/Workers).

**Added**

* A small shared **“integration test docker-compose”** lives in `infra` to run brokers stubs with any service PR (optional).

**Removed**

* Monorepo-local import paths in examples.

**Action required**

* Validate token sealing works end-to-end after repo split (Core still seals; Workers unwrap).

---

## Doc 09 — Observability & Ops

**Changed**

* Dashboards now reference **multiple services** (multi-repo) but same metrics.
* Release markers originate from **`infra`** on prod apply (per service).

**Added**

* A “system E2E” synthetic in `infra` that runs after any staging deploy (login → import → reflect).

**Removed**

* Build graph-based deploy gates (moved to per-repo CI).

**Action required**

* Wire alert routing to repo codeowners; update runbook links to repo-local docs.

---

## Doc 10 — Security Playbook

**Changed**

* **Supply chain**: scans & SBOM per repo; all images **signed** (Cosign) in each repo.
* OIDC/GCP deploy identity per repo; least-privilege SA per service.

**Added**

* “Contracts publishing” checklist (semver bump, schema diff, publish & notify).

**Removed**

* Centralized secret store assumptions inside a monorepo (now per repo + cloud secret manager).

**Action required**

* Create per-repo GH environments (dev/staging/prod) and secrets.
* Ensure **same CSP/HSTS** policy in Edge; unchanged elsewhere.

---

## Doc 11 — Test Strategy

**Changed**

* **Units/Integrations** run **per repo**.
* **Contract tests** bind to the **published** `@<scope>/contracts` version.
* **Pact (optional)** now uses a broker (or GH Packages) across repos.

**Added**

* `infra` hosts suite for **system E2E** against staging (Playwright/k6) triggered when any service deploys to staging.

**Removed**

* Monorepo “affected graph” as a gate (replaced by narrow per-repo CI).

**Action required**

* Add a “contracts schema drift” job in `contracts` CI (fail MAJOR changes without version bump).

---

## Doc 12 — Deployment & Environments (Low-Cost → Scalable)

**Changed**

* Execution model unchanged (Cloud Run + Neon + Upstash + R2).
* **Staging** deploys from **service repo**; **Prod** deploys from **infra repo** by updating **image digests** per service.

**Added**

* In `infra`, variables per service:
  `edge_image`, `core_image`, `workers_image`, `web_image`, `ai_image`.

**Removed**

* Single-repo Terraform apply assumptions.

**Action required**

* Stand up `infra` repo Terraform with those variables; wire GitHub OIDC for `infra`.

---

## Doc 12B — Provider Mapping + Terraform Starter

**Changed**

* Split Terraform ownership into **`infra` repo**; images are **inputs** set by CI PRs from service tags.
* Service repos no longer run `terraform apply`; they only **build & push** images and (optionally) deploy **staging** via direct Cloud Run update or by opening an `infra` PR for staging.

**Added**

* An “automation PR” script snippet (in each service repo) that, on `*-v*` tag, opens an `infra` PR updating only its own variable to the **exact digest**.

**Removed**

* Monorepo terraform variables like `image_edge` baked into one workflow.

**Action required**

* Copy the per-service `deploy-staging.yml` and `tag-to-infra-pr.yml` into each repo; set `infra` repo token/permissions.

---

## Doc 13 — CI/CD (GitHub Actions)

**Changed**

* **Split pipelines per repo**:

  * Service repos: build → test → push image on `main` (staging); deploy staging; on tag → open `infra` PR to promote to prod.
  * `contracts`: build → test → **publish** NPM + schemas artifact (on tag); open Renovate PRs (or rely on scheduled Renovate).
  * `infra`: on PR merge, **terraform apply** to staging/prod.

**Added**

* Sample “open PR to infra” action using a GitHub App token:

  * Reads image digest from registry; commits change to `infra/envs/prod.tfvars` for its own variable (e.g., `core_image`).
* (Optional) **System E2E** job in `infra` after any staging apply.

**Removed**

* Monorepo “build only affected” logic in Actions (now inherent by repo scope).

**Action required**

* Install Renovate/Dependabot across repos for `@<scope>/contracts` bumps.
* Create a reusable GH Action that every service can call to open the **infra PR**.

---

## Doc — Shared Contracts (Zod)

**Changed**

* `@<scope>/contracts` lives in its own repo; published to private NPM.
* Consumers pin versions; Python AI consumes **schemas** artifact for codegen.

**Added**

* CI: schema diff guard; **semantic-release/Changesets** to enforce semver.

**Removed**

* Workspace-based imports, local path references.

**Action required**

* Update import paths in services; wire Renovate to bump contracts automatically.

---

## New (Polyrepo-only) — “Release & Promotion” Cheat Sheet

**Staging**

1. Merge to `main` in a service repo → CI builds image `:sha`, deploys **staging** (that service only).
2. `infra` optionally runs **system E2E**.

**Production**

1. In the service repo: `git tag core-v0.10.0 && git push --tags`.
2. The tag workflow:

   * resolves `:sha` digest,
   * opens PR in `infra` to set `core_image = "...@sha256:<digest>"`.
3. Review & merge in `infra` → `terraform apply` updates **only Core**.

**Contracts release**

1. In `contracts`: `contracts-v0.3.2` → publish NPM + schemas.
2. Renovate opens **bump PRs** across service repos.
3. Merge bumps → each service redeploys to staging.
4. Tag services you wish to promote.

---

## Cross-doc “No-Change” Notes

* **Domain model, ERD, event taxonomy, rules engine, security controls, SLOs**: **no functional changes**. Only CI/release mechanics moved to polyrepo.
* **Mobile integration**: unchanged; still consumes Edge/BFF & events; uses token-based auth; can live in its own repo `mobile`.

---

## One-time Migration Tasks

* [ ] Create repos; import code from monorepo folders (preserve history with `git filter-repo`).
* [ ] Stand up `contracts` repo; publish initial `v1.0.0`.
* [ ] Update imports (`@<scope>/contracts`), add schema codegen in `ai-coach`.
* [ ] Configure per-repo CI (staging deploy) and tag → `infra` PR workflows.
* [ ] Configure `infra` Terraform with per-service image variables and OIDC auth.
* [ ] Enable Renovate/Dependabot for contracts bumps.
* [ ] Update runbooks/links to point to polyrepo locations.

* a tiny **system E2E** workflow in `infra`,
* and a **repo creation checklist** you can hand to your team.
