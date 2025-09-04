# 13 — CI/CD (Polyrepo)

## Service Repos (web-ui, edge-bff, core-api, workers, ai-coach)
- On PR: lint/tests/build.
- On merge to main: build image → deploy **staging** (that service).
- On tag `service-vX.Y.Z`: resolve `:sha` digest → open **infra PR** to bump that service image in **prod**.

## Contracts Repo
- On tag `contracts-vX.Y.Z`: publish NPM + schemas artifact, trigger Renovate PRs in consumers.

## Infra Repo
- On PR merge: `terraform apply` for target env.
- Optional: run **system E2E** against staging after any apply.
