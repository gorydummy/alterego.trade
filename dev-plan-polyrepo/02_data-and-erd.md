# 02 — Data & ERD (Core Entities)

## Entities
- **User**(id (nanoid), email, passwordHash?, createdAt)
- **Session**(id (nanoid), userId, createdAt, expiresAt)
- **BrokerAccount**(id (nanoid), userId, broker, status, createdAt)
- **OAuthToken**(id (nanoid), brokerAccountId, accessEnc, refreshEnc, scope, createdAt, updatedAt)
- **Trade**(id (nanoid), userId, broker, extId, symbol, side, qty, price, fee?, ts, createdAt, updatedAt)
- **BiasTag**(id (nanoid), tradeId, label[FOMO|PANIC|DISCIPLINE|NEUTRAL], confidence, features(jsonb), createdAt)
- **SimulationResult**(id (nanoid), userId, tradeId, horizonDays, deltaPnl, params(jsonb), createdAt)
- **WeeklyDigest**(id (nanoid), userId, periodStart, periodEnd, stats(jsonb), url?)
- **EventOutbox**(eventId (ULID), type, v, ts, userId, payload(jsonb), deliveredAt?)
- **Audit**(id (nanoid), userId?, action, ipHash, uaHash, ts)

## ERD (Mermaid)
```mermaid
erDiagram
  User ||--o{ Session : has
  User ||--o{ BrokerAccount : owns
  BrokerAccount ||--|| OAuthToken : holds
  User ||--o{ Trade : makes
  Trade ||--o{ BiasTag : annotatedBy
  User ||--o{ SimulationResult : explores
  User ||--o{ WeeklyDigest : receives
  User ||--o{ EventOutbox : emits
  User ||--o{ Audit : records
```