# 12B — Provider Mapping + Terraform Starter (Infra Repo)

## Providers
- Cloud Run (GCP), Neon Postgres, Upstash Redis, Cloudflare R2/DNS.

## Terraform Inputs (per env)
```hcl
edge_image    = "asia.../edge@sha256:digest"
core_image    = "asia.../core@sha256:digest"
workers_image = "asia.../workers@sha256:digest"
web_image     = "asia.../web@sha256:digest"
ai_image      = "asia.../ai@sha256:digest"
```
- Variables for DB URL, Redis tokens, R2 keys, domains.

## Notes
- Staging applies on merge; prod applies when a service tag PR is merged.
