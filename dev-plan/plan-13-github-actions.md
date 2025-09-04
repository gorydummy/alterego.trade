# 13 — CI/CD (GitHub Actions • Cloud Run • Terraform)

## What you get

* **ci.yml** → fast checks (lint/tests), image build on PRs (no push).
* **deploy.yml** → build & push images, then **terraform apply** with env-specific vars (dev/staging on main; prod on tag or manual).

> Assumes repo layout from previous docs:
>
> * `apps/edge`, `apps/core`, `apps/workers`, `apps/ai-coach` each with a Dockerfile
> * Terraform in `infra/` (from section 12B)

---

## 0) One-time setup

### A. GitHub Environments & Secrets

Create **three GitHub environments**: `dev`, `staging`, `prod`.
Add these **environment secrets** (per environment):

| Secret                  | Example / Note                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`        | e.g., `tc-app-prod`                                                                                                                                                          |
| `GCP_REGION`            | `asia-southeast1`                                                                                                                                                            |
| `GCP_WORKLOAD_IDP`      | Google Workload Identity Provider resource (format: `projects/123456789/locations/global/workloadIdentityPools/gh-pool/providers/gh-provider`)                               |
| `GCP_SERVICE_ACCOUNT`   | SA email with `roles/run.admin`, `roles/iam.serviceAccountUser`, `roles/storage.admin`, `roles/artifactregistry.writer` (e.g., `deploy@tc-app-prod.iam.gserviceaccount.com`) |
| `CLOUDFLARE_ACCOUNT_ID` | from Cloudflare                                                                                                                                                              |
| `CLOUDFLARE_ZONE_ID`    | zone of your domain                                                                                                                                                          |
| `CLOUDFLARE_API_TOKEN`  | token with DNS + R2 permissions                                                                                                                                              |
| `NEON_API_KEY`          | Neon account API key                                                                                                                                                         |
| `UPSTASH_API_KEY`       | Upstash API key                                                                                                                                                              |
| `UPSTASH_EMAIL`         | Upstash account email                                                                                                                                                        |
| `DOMAIN_EDGE`           | e.g., `app.example.com`                                                                                                                                                      |
| `GAR_REPOSITORY`        | Artifact Registry repo name, e.g., `tc-images` (will be created)                                                                                                             |

> You can add **environment protection rules** (required reviewers) on `prod` so deploys require manual approval.

### B. Create Artifact Registry (once)

```bash
gcloud services enable artifactregistry.googleapis.com --project <GCP_PROJECT_ID>
gcloud artifacts repositories create $GAR_REPOSITORY \
  --repository-format=docker --location=asia-southeast1 --project <GCP_PROJECT_ID>
```

---

## 1) `.github/workflows/ci.yml` (fast checks on PRs)

```yaml
name: CI

on:
  pull_request:
    branches: [ main ]
  push:
    branches: [ feature/** ]

jobs:
  test-and-build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      # Node + Python toolchains for unit tests (adjust versions as needed)
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }

      - name: Install JS deps
        run: |
          npm ci --workspaces

      - name: Run JS tests
        run: |
          npm test --workspaces --if-present

      - name: Run Python tests (AI Coach)
        working-directory: apps/ai-coach
        run: |
          pip install -r requirements.txt
          pytest -q

      # Build images (no push)
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3
      - name: Build images (no push)
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./apps/edge/Dockerfile
          platforms: linux/amd64
          push: false
      # (optional) repeat for other Dockerfiles to catch build issues
```

---

## 2) `.github/workflows/deploy.yml` (build → push → terraform)

```yaml
name: Deploy

on:
  push:
    branches: [ main ]          # auto-deploy dev/staging on main
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        type: choice
        options: [ dev, staging, prod ]
  push:
    tags:
      - 'v*'                    # tagging creates a prod release

env:
  IMAGE_TAG: ${{ github.sha }}

jobs:
  plan-deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 60

    # Decide environment
    env:
      FALLBACK_ENV: dev

    outputs:
      env_name: ${{ steps.pick-env.outputs.env_name }}
      image_edge: ${{ steps.build-push.outputs.image_edge }}
      image_core: ${{ steps.build-push.outputs.image_core }}
      image_workers: ${{ steps.build-push.outputs.image_workers }}
      image_ai: ${{ steps.build-push.outputs.image_ai }}

    steps:
      - uses: actions/checkout@v4

      - id: pick-env
        name: Pick environment
        run: |
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            echo "env_name=${{ github.event.inputs.environment }}" >> $GITHUB_OUTPUT
          elif [[ "${{ github.ref_type }}" == "tag" ]]; then
            echo "env_name=prod" >> $GITHUB_OUTPUT
          else
            # main branch default: staging (or dev; choose your flow)
            echo "env_name=staging" >> $GITHUB_OUTPUT
          fi

      # Authenticate to GCP via OIDC (no key file)
      - name: Google Auth (OIDC)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDP }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}

      - name: Set up gcloud
        uses: google-github-actions/setup-gcloud@v2
        with:
          project_id: ${{ secrets.GCP_PROJECT_ID }}

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker asia-southeast1-docker.pkg.dev --quiet

      - name: Create Artifact Registry repo if missing
        run: |
          gcloud artifacts repositories create "${{ secrets.GAR_REPOSITORY }}" \
            --repository-format=docker --location=${{ secrets.GCP_REGION }} \
            --project ${{ secrets.GCP_PROJECT_ID }} || true

      - name: Compute image URLs
        id: img
        run: |
          REPO_HOST="${{ secrets.GCP_REGION }}-docker.pkg.dev"
          PROJECT="${{ secrets.GCP_PROJECT_ID }}"
          REPO="${{ secrets.GAR_REPOSITORY }}"
          echo "EDGE=${REPO_HOST}/${PROJECT}/${REPO}/edge:${{ env.IMAGE_TAG }}" >> $GITHUB_OUTPUT
          echo "CORE=${REPO_HOST}/${PROJECT}/${REPO}/core:${{ env.IMAGE_TAG }}" >> $GITHUB_OUTPUT
          echo "WORKERS=${REPO_HOST}/${PROJECT}/${REPO}/workers:${{ env.IMAGE_TAG }}" >> $GITHUB_OUTPUT
          echo "AI=${REPO_HOST}/${PROJECT}/${REPO}/ai-coach:${{ env.IMAGE_TAG }}" >> $GITHUB_OUTPUT

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3

      - id: build-push
        name: Build & push all images
        run: |
          docker buildx build --platform linux/amd64 -t "${{ steps.img.outputs.EDGE }}" --push ./apps/edge
          docker buildx build --platform linux/amd64 -t "${{ steps.img.outputs.CORE }}" --push ./apps/core
          docker buildx build --platform linux/amd64 -t "${{ steps.img.outputs.WORKERS }}" --push ./apps/workers
          docker buildx build --platform linux/amd64 -t "${{ steps.img.outputs.AI }}" --push ./apps/ai-coach
          echo "image_edge=${{ steps.img.outputs.EDGE }}" >> $GITHUB_OUTPUT
          echo "image_core=${{ steps.img.outputs.CORE }}" >> $GITHUB_OUTPUT
          echo "image_workers=${{ steps.img.outputs.WORKERS }}" >> $GITHUB_OUTPUT
          echo "image_ai=${{ steps.img.outputs.AI }}" >> $GITHUB_OUTPUT

      # Terraform — plan & apply
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.7.5

      - name: Terraform Init
        working-directory: infra
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          UPSTASH_API_KEY: ${{ secrets.UPSTASH_API_KEY }}
          UPSTASH_EMAIL: ${{ secrets.UPSTASH_EMAIL }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          GOOGLE_PROJECT: ${{ secrets.GCP_PROJECT_ID }}
        run: terraform init -input=false

      - name: Terraform Plan
        id: tfplan
        working-directory: infra
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          UPSTASH_API_KEY: ${{ secrets.UPSTASH_API_KEY }}
          UPSTASH_EMAIL: ${{ secrets.UPSTASH_EMAIL }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          terraform plan -input=false \
            -var "gcp_project=${{ secrets.GCP_PROJECT_ID }}" \
            -var "gcp_region=${{ secrets.GCP_REGION }}" \
            -var "cloudflare_account_id=${{ secrets.CLOUDFLARE_ACCOUNT_ID }}" \
            -var "cloudflare_zone_id=${{ secrets.CLOUDFLARE_ZONE_ID }}" \
            -var "domain_edge=${{ secrets.DOMAIN_EDGE }}" \
            -var "image_edge=${{ steps.build-push.outputs.image_edge }}" \
            -var "image_core=${{ steps.build-push.outputs.image_core }}" \
            -var "image_workers=${{ steps.build-push.outputs.image_workers }}" \
            -var "image_ai=${{ steps.build-push.outputs.image_ai }}"

      # Require manual approval on prod via environment protection
      - name: Terraform Apply
        if: always()
        working-directory: infra
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          UPSTASH_API_KEY: ${{ secrets.UPSTASH_API_KEY }}
          UPSTASH_EMAIL: ${{ secrets.UPSTASH_EMAIL }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          terraform apply -input=false -auto-approve \
            -var "gcp_project=${{ secrets.GCP_PROJECT_ID }}" \
            -var "gcp_region=${{ secrets.GCP_REGION }}" \
            -var "cloudflare_account_id=${{ secrets.CLOUDFLARE_ACCOUNT_ID }}" \
            -var "cloudflare_zone_id=${{ secrets.CLOUDFLARE_ZONE_ID }}" \
            -var "domain_edge=${{ secrets.DOMAIN_EDGE }}" \
            -var "image_edge=${{ steps.build-push.outputs.image_edge }}" \
            -var "image_core=${{ steps.build-push.outputs.image_core }}" \
            -var "image_workers=${{ steps.build-push.outputs.image_workers }}" \
            -var "image_ai=${{ steps.build-push.outputs.image_ai }}"

    environment: ${{ steps.pick-env.outputs.env_name }}
```

### Notes

* **Environment scoping**: the `environment:` line ensures the job uses the secrets from `dev`, `staging`, or `prod`, and can enforce approval for `prod`.
* **Images**: each push is tagged with the commit SHA; Terraform updates Cloud Run services by image tag.
* **State**: Terraform currently uses **local state**. For prod, switch to a **GCS backend** with locking (add a backend block and grant the SA bucket perms).

---

## 3) Optional: `destroy.yml` (manual teardown for sandbox envs)

```yaml
name: Destroy (Env)

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to destroy (careful!)'
        required: true
        type: choice
        options: [ dev, staging ]

jobs:
  destroy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    steps:
      - uses: actions/checkout@v4

      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDP }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2
        with: { project_id: ${{ secrets.GCP_PROJECT_ID }} }

      - uses: hashicorp/setup-terraform@v3
        with: { terraform_version: 1.7.5 }

      - name: Terraform Destroy
        working-directory: infra
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          UPSTASH_API_KEY: ${{ secrets.UPSTASH_API_KEY }}
          UPSTASH_EMAIL: ${{ secrets.UPSTASH_EMAIL }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          terraform init -input=false
          terraform destroy -auto-approve -input=false \
            -var "gcp_project=${{ secrets.GCP_PROJECT_ID }}" \
            -var "gcp_region=${{ secrets.GCP_REGION }}" \
            -var "cloudflare_account_id=${{ secrets.CLOUDFLARE_ACCOUNT_ID }}" \
            -var "cloudflare_zone_id=${{ secrets.CLOUDFLARE_ZONE_ID }}" \
            -var "domain_edge=${{ secrets.DOMAIN_EDGE }}" \
            -var "image_edge=dummy" -var "image_core=dummy" -var "image_workers=dummy" -var "image_ai=dummy"
```

---

## 4) Registry & runtime env wiring

* Cloud Run services get their URLs from Terraform; your **Edge** service can reference **Core** URL via env (`CORE_BASE`), or just call by internal DNS if you later add a VPC connector.
* For app secrets (DB URL, Redis, R2 keys, AI HMAC), prefer **Google Secret Manager** + mount at runtime, or inject as Cloud Run env vars in Terraform.

---

## 5) Cost & scalability reminders

* **Min instances**: Edge=2 (HA), Core/Workers/AI=1 to keep cost low; autoscale on CPU/latency/queue depth.
* **Neon/Upstash** free/low tiers are fine for early MVP; upgrade when DAU grows.
* Keep **R2** for digests/exports with lifecycle rules (e.g., IA after 30 days).
