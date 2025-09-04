# 15 — Polyrepo Architecture & Dev Flow

## Repos
`web-ui`, `edge-bff`, `core-api`, `workers`, `ai-coach`, `contracts`, `infra` (+ `mobile` later).

## Staging
- Merge to `main` in a service repo → build/push → deploy **that service** to staging.

## Production
- Push tag `edge-v1.5.0` (in edge-bff repo) → CI opens PR in `infra` to pin edge image digest → merge → apply prod (Edge only).

## Contracts
- Publish `@scope/contracts@X.Y.Z` + schemas artifact; Renovate PRs bump consumers.
- Python AI regenerates models from schemas on build.

## Diagrams
- See earlier sequence diagrams for import→reflect, and push notification flow.
