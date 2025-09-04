# 11 — Test Strategy

## Pyramid
- Unit (Vitest/Jest/Pytest) → many, fast.
- Integration (Testcontainers) → real deps.
- Contract (Zod/JSON Schema, Pact optional).
- E2E (Playwright) → few user-journey tests.
- Ops probes → login/import/reflect/AI.

## Fixtures
- OHLCV golden, trade examples, bias cases.

## CI Gates
- Coverage ≥ 80% overall; schema drift guard; SAST/SCA pass; Pact pass.

## E2E
- Auth, Connect broker, Import→Reflect bubble, Simulation modal, Weekly digest.
