# 10 — Security Playbook

## TL;DR
- JWT (RS256, 15m) in HttpOnly cookie; CSRF double-submit.
- Secrets sealed AES‑GCM (per‑tenant DEK, KMS‑wrapped).
- HMAC on AI calls; rate limits; idempotency everywhere.
- No PII in logs; strict CSP/HSTS; TLS only.

## Threat Model (STRIDE) & Controls
- Spoofing: short JWT, JWKS rotation, IP/UA hash audit.
- Tampering: DTO validation, signed JWT, outbox in DB.
- Repudiation: audit with ipHash/uaHash.
- Info disclosure: token sealing, redaction.
- DoS: rate limits, queue backpressure.
- Elevation: CSRF + authz checks at Edge.

## Storage
- Postgres TLS; separate roles; partitions; backups + WAL.
- Redis private/no persistence; AUTH; `allkeys-lru`.
- R2/S3 private, signed URLs, versioning.

## Headers (Edge)
- HSTS, CSP, Referrer-Policy, Permissions-Policy, Nosniff.

## Incidents
- SEV levels, runbooks, RCA within 48h.
