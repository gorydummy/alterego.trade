# 05 — Stack 3: Core API

## Responsibilities
- Domain endpoints, persistence, event outbox append + replay, JWKS issuer.
- Token sealing for broker OAuth (AES‑GCM with per‑tenant DEK wrapped by KMS).

## Key Endpoints
- `/internal/events?since=...` → outbox replay
- `/trades/import` → enqueue job, append `import.progress`
- `/trades` CRUD (read-heavy)
- `/simulations/simple`
- `/digests/weekly/latest`

## Outbox
- Table partitioned monthly; payload excludes secrets/PII.
- Replay supports cursor `since=eventId`.

## Migrations
- Expand → backfill → contract pattern. Prisma/SQL.

## Security
- JWT verify on every call; scopes/ownership check per `userId`.
